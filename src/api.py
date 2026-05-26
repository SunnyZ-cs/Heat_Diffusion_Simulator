import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
import threading
import json
import numpy as np
from flask import Flask, jsonify, request, abort
from flask_cors import CORS
from werkzeug.exceptions import BadRequest
from dataclasses import asdict, is_dataclass, fields, MISSING

from src.heat_solver import HeatEquationSolver, SimulationConfig, HeatSource
from src.material_map_builder import MaterialMapBuilder
from src.shapes import validate_rectangle_bounds, validate_ellipse_bounds
from examples.configs import (
    get_basic_diffusion_config,
    get_with_boundaries_config,
    get_simple_shapes_config,
    get_heat_sink_config,
    get_thermal_barrier_config,
)

app = Flask(__name__)
CORS(app)

# --- State Management ---

# Using a lock to ensure thread-safe access to the shared jobs dictionary.
# This prevents race conditions when multiple threads update the same job status.
SIMULATION_JOBS_LOCK = threading.Lock()

# This dictionary holds the state of all simulation jobs.
SIMULATION_JOBS = {}

# --- Material Map Storage ---

# Using a separate lock for material map operations to avoid contention
MATERIAL_MAPS_LOCK = threading.Lock()

# This dictionary holds MaterialMapBuilder instances
MATERIAL_MAPS = {}

# --- Example Configuration Mapping ---

# This dictionary cleanly maps user-friendly names to functions that return
# the corresponding SimulationConfig object. This is easily extensible.
EXAMPLE_CONFIG_FUNCTIONS = {
    'basic_diffusion': get_basic_diffusion_config,
    'with_boundaries': get_with_boundaries_config,
    'simple_shapes': get_simple_shapes_config,
    'heat_sink': get_heat_sink_config,
    'thermal_barrier': get_thermal_barrier_config,
}

# --- Custom JSON Encoder for NumPy and Dataclasses ---

class NumpyEncoder(json.JSONEncoder):
    """
    Custom JSON encoder to handle special data types that the default
    encoder doesn't know about, such as NumPy arrays, dataclasses, and MaterialMapBuilder.
    """
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()  # Convert NumPy arrays to Python lists
        if isinstance(obj, np.integer):
            return int(obj)      # Convert NumPy integers to Python ints
        if isinstance(obj, np.floating):
            return float(obj)    # Convert NumPy floats to Python floats
        if isinstance(obj, MaterialMapBuilder):
            return obj.to_dict()  # Convert MaterialMapBuilder to dictionary
        if is_dataclass(obj):
            return asdict(obj)   # Convert dataclasses to dictionaries
        return super(NumpyEncoder, self).default(obj)

# Register the custom encoder with the Flask app
app.json_encoder = NumpyEncoder

# --- Background Simulation Worker ---

def run_simulation_worker(job_id: str, config: SimulationConfig):
    """
    This function runs the simulation in a background thread to avoid
    blocking the API. It updates the job's status in the global dictionary.
    """
    try:
        # Define a progress callback that updates the job's progress safely
        def progress_callback(progress, _):
            with SIMULATION_JOBS_LOCK:
                if job_id in SIMULATION_JOBS:
                    SIMULATION_JOBS[job_id]['progress'] = round(progress * 100, 2)

        # Initialize and run the solver
        solver = HeatEquationSolver(config)
        history = solver.run(progress_callback=progress_callback)

        # On completion, update the job status and store the result
        with SIMULATION_JOBS_LOCK:
            SIMULATION_JOBS[job_id].update({
                'status': 'completed',
                'progress': 100,
                'result': history
            })

    except Exception as e:
        # If an error occurs, update the job with the failure status and message
        with SIMULATION_JOBS_LOCK:
            SIMULATION_JOBS[job_id].update({
                'status': 'failed',
                'error': str(e)
            })

# --- API Endpoints ---

@app.route('/api/examples', methods=['GET'])
def get_examples():
    """Returns a list of available predefined example names."""
    return jsonify(list(EXAMPLE_CONFIG_FUNCTIONS.keys()))


@app.route('/api/examples/<example_name>', methods=['GET'])
def get_example_config(example_name):
    """
    Returns the JSON configuration for a named example. This allows a UI
    to fetch a template configuration to display or modify.
    """
    if example_name not in EXAMPLE_CONFIG_FUNCTIONS:
        abort(404, description=f"Example '{example_name}' not found.")

    config_func = EXAMPLE_CONFIG_FUNCTIONS[example_name]
    config_obj = config_func()

    # handle the numpy array in the 'heterogeneous_material' config.
    response_json = json.dumps(config_obj, cls=NumpyEncoder, indent=2)
    return response_json, 200, {'Content-Type': 'application/json'}


@app.route('/api/simulations', methods=['POST'])
def create_simulation():
    """
    Starts a new simulation. The request body must specify either an 'example_name'
    or a 'config' object, but not both.
    """
    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    # Enforce that either 'example_name' or 'config' is present, but not both.
    has_example = 'example_name' in data
    has_config = 'config' in data

    if not has_example and not has_config:
        abort(400, description="Request must include either 'example_name' or 'config'.")
    if has_example and has_config:
        abort(400, description="Request cannot include both 'example_name' and 'config'.")

    sim_config: SimulationConfig

    if has_example:
        example_name = data['example_name']
        if example_name not in EXAMPLE_CONFIG_FUNCTIONS:
            abort(404, description=f"Example '{example_name}' not found.")
        config_func = EXAMPLE_CONFIG_FUNCTIONS[example_name]
        sim_config = config_func()
    else:
        try:
            config_data = data['config']
            # Convert nested list back to numpy array if present
            if 'material_map' in config_data and config_data['material_map']:
                config_data['material_map'] = np.array(config_data['material_map'])
            # Re-hydrate HeatSource objects from dictionaries
            if 'heat_sources' in config_data:
                config_data['heat_sources'] = [HeatSource(**src) for src in config_data['heat_sources']]
            sim_config = SimulationConfig(**config_data)
        except (TypeError, ValueError) as e:
            # (e.g., stability issues, bad parameters)
            raise BadRequest(f"Invalid configuration parameters: {e}") from e

    job_id = str(uuid.uuid4())

    # Safely initialize the job entry in the shared dictionary
    with SIMULATION_JOBS_LOCK:
        SIMULATION_JOBS[job_id] = {'status': 'pending', 'progress': 0}

    # Start the simulation in a background thread
    thread = threading.Thread(target=run_simulation_worker, args=(job_id, sim_config))
    thread.daemon = True
    thread.start()

    with SIMULATION_JOBS_LOCK:
        SIMULATION_JOBS[job_id]['status'] = 'running'

    response = jsonify({
        'job_id': job_id,
        'status': 'running',
        'message': 'Simulation started.',
        'location': f'/api/simulations/{job_id}'
    })
    response.status_code = 202
    response.headers['Location'] = f'/api/simulations/{job_id}'
    return response


@app.route('/api/simulations/custom', methods=['POST'])
def create_custom_simulation():
    """
    Starts a new simulation with custom parameters.
    Uses fixed spatial discretization (100x100 grid) and automatically calculates
    time step for numerical stability.

    Request Body:
        {
            "total_time": float (0.1-2.0 seconds),
            "initial_temperature": float (15-25°C),
            "boundary_temperatures": {
                "left": float (0-100°C),
                "right": float (0-100°C),
                "top": float (0-100°C),
                "bottom": float (0-100°C)
            },
            "diffusivity": float (0.01-10.0)
        }
    """
    # Fixed spatial discretization parameters
    GRID_SIZE = 100  # Fixed 100x100 grid
    DOMAIN_WIDTH = 1.0  # Physical domain: 1m x 1m

    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    try:
        # Extract and validate parameters
        total_time = data['total_time']
        initial_temp = data['initial_temperature']
        boundary_temps = data['boundary_temperatures']
        diffusivity = data['diffusivity']

        # Validate ranges
        if not (0.1 <= total_time <= 2.0):
            raise ValueError("total_time must be between 0.1 and 2.0 seconds")
        if not (15 <= initial_temp <= 25):
            raise ValueError("initial_temperature must be between 15 and 25°C")
        if not (0.01 <= diffusivity <= 10.0):
            raise ValueError("diffusivity must be between 0.01 and 10.0")

        # Validate boundary temperatures
        for side in ['left', 'right', 'top', 'bottom']:
            if side not in boundary_temps:
                raise ValueError(f"Missing boundary temperature for '{side}'")
            temp = boundary_temps[side]
            if not (0 <= temp <= 100):
                raise ValueError(f"Boundary temperature for '{side}' must be between 0 and 100°C")

        # Calculate time step based on CFL condition for numerical stability
        # The stability condition is: α * dt * (1/dx² + 1/dy²) <= 0.25
        dx = DOMAIN_WIDTH / GRID_SIZE
        dy = DOMAIN_WIDTH / GRID_SIZE  # Square domain
        max_stable_dt = 0.25 / (diffusivity * (1 / dx**2 + 1 / dy**2))
        time_step = min(max_stable_dt * 0.9, 0.01)  # Use 90% of max stable for safety

        # Ensure we have at least 10 time steps for smooth animation
        min_time_steps = 10
        max_time_step = total_time / min_time_steps
        time_step = min(time_step, max_time_step)

        # Calculate appropriate save_interval to target ~50-100 frames for good animation
        total_timesteps = int(total_time / time_step)
        target_frames = min(100, max(20, total_timesteps // 20))  # 20-100 frames
        save_interval = max(1, total_timesteps // target_frames)

        # Create simulation config with fixed grid size and calculated time step
        sim_config = SimulationConfig(
            width=GRID_SIZE,
            height=GRID_SIZE,
            total_time=total_time,
            dt=time_step,
            save_interval=save_interval,
            initial_temp=initial_temp,
            boundary_temp_left=boundary_temps['left'],
            boundary_temp_right=boundary_temps['right'],
            boundary_temp_top=boundary_temps['top'],
            boundary_temp_bottom=boundary_temps['bottom'],
            material_diffusivity=diffusivity,
            material_map=None,
            heat_sources=[]
        )

    except (KeyError, ValueError) as e:
        abort(400, description=f"Invalid parameters: {e}")

    # Create and start simulation job
    job_id = str(uuid.uuid4())

    with SIMULATION_JOBS_LOCK:
        SIMULATION_JOBS[job_id] = {'status': 'pending', 'progress': 0}

    # Start the simulation in a background thread
    thread = threading.Thread(target=run_simulation_worker, args=(job_id, sim_config))
    thread.daemon = True
    thread.start()

    with SIMULATION_JOBS_LOCK:
        SIMULATION_JOBS[job_id]['status'] = 'running'

    response = jsonify({
        'job_id': job_id,
        'status': 'running',
        'message': 'Custom simulation started.',
        'location': f'/api/simulations/{job_id}',
        'grid_size': f'{GRID_SIZE}x{GRID_SIZE}',
        'time_step': round(time_step, 6)
    })
    response.status_code = 202
    response.headers['Location'] = f'/api/simulations/{job_id}'
    return response


@app.route('/api/simulations/<job_id>', methods=['GET'])
@app.route('/api/simulations/<job_id>/status', methods=['GET'])
def get_simulation_status(job_id):
    """Returns the status, progress, and error state of a simulation job."""
    with SIMULATION_JOBS_LOCK:
        job = SIMULATION_JOBS.get(job_id)

    if not job:
        abort(404, description=f"Job with ID '{job_id}' not found.")

    response_data = {
        'job_id': job_id,
        'status': job['status'],
        'progress': job['progress'],
        'error': job.get('error')
    }

    if job.get('status') == 'completed':
        response_data['results_location'] = f'/api/simulations/{job_id}/results'
        response_data['frame_count'] = len(job.get('result', []))

    return jsonify(response_data)


@app.route('/api/simulations/<job_id>/results', methods=['GET'])
def get_simulation_results(job_id):
    """
    Returns results of a completed simulation. For performance, this supports
    fetching a single frame via a query parameter (e.g., ?frame=10 or ?frame=last),
    which is critical for UIs handling large result sets.
    """
    with SIMULATION_JOBS_LOCK:
        job = SIMULATION_JOBS.get(job_id)

    if not job or job.get('status') != 'completed':
        abort(404, description=f"Results for job ID '{job_id}' not found or job is not complete.")

    frame_param = request.args.get('frame')
    results = job.get('result', [])

    if frame_param is not None:
        # Handle 'last' as a special case
        if frame_param.lower() == 'last':
            if results:
                return jsonify(results[-1])
            else:
                abort(404, description="No frames available in results.")

        # Handle numeric frame index
        try:
            frame_index = int(frame_param)
            if 0 <= frame_index < len(results):
                return jsonify(results[frame_index])
            else:
                abort(400, description=f"Frame index out of bounds. Must be between 0 and {len(results)-1}.")
        except ValueError:
            abort(400, description="Invalid 'frame' parameter. Must be an integer or 'last'.")

    return jsonify(results)

# --- Material Map API Endpoints ---

@app.route('/api/materials/create', methods=['POST'])
def create_material_map():
    """
    Create a new material design.

    Request Body:
        {
            "width": int,
            "height": int,
            "base_diffusivity": float
        }

    Returns:
        {
            "material_id": str,
            "status": "created",
            "info": {...}
        }
    """
    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    try:
        width = data['width']
        height = data['height']
        base_diffusivity = data['base_diffusivity']

        # Validate parameters
        if not isinstance(width, int) or width <= 0:
            raise ValueError("Width must be a positive integer")
        if not isinstance(height, int) or height <= 0:
            raise ValueError("Height must be a positive integer")
        if not isinstance(base_diffusivity, (int, float)) or base_diffusivity <= 0:
            raise ValueError("Base diffusivity must be a positive number")

    except (KeyError, ValueError) as e:
        abort(400, description=f"Invalid parameters: {e}")

    # Create new MaterialMapBuilder
    builder = MaterialMapBuilder(width, height, base_diffusivity)
    material_id = str(uuid.uuid4())

    # Store safely
    with MATERIAL_MAPS_LOCK:
        MATERIAL_MAPS[material_id] = builder

    response = jsonify({
        'material_id': material_id,
        'status': 'created',
        'info': builder.get_info()
    })
    response.status_code = 201
    response.headers['Location'] = f'/api/materials/{material_id}'
    return response


@app.route('/api/materials/<material_id>/add-rectangle', methods=['POST'])
def add_rectangle_shape(material_id):
    """
    Add a rectangle shape to a material map.

    Request Body:
        {
            "x": int,
            "y": int,
            "rect_width": int,
            "rect_height": int,
            "diffusivity": float
        }

    Returns:
        {
            "shape_id": str,
            "shape_type": "rectangle",
            "status": "added",
            "total_shapes": int
        }
    """
    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    try:
        x = data['x']
        y = data['y']
        rect_width = data['rect_width']
        rect_height = data['rect_height']
        diffusivity = data['diffusivity']

        # Validate parameters
        if not isinstance(x, int) or not isinstance(y, int):
            raise ValueError("x and y must be integers")
        if not isinstance(rect_width, int) or rect_width <= 0:
            raise ValueError("rect_width must be a positive integer")
        if not isinstance(rect_height, int) or rect_height <= 0:
            raise ValueError("rect_height must be a positive integer")
        if not isinstance(diffusivity, (int, float)) or diffusivity <= 0:
            raise ValueError("diffusivity must be a positive number")

    except (KeyError, ValueError) as e:
        abort(400, description=f"Invalid parameters: {e}")

    # Keep lock during entire operation to prevent race conditions
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        try:
            shape_id = builder.add_rectangle(x, y, rect_width, rect_height, diffusivity)
            total_shapes = builder.get_shape_count()
        except ValueError as e:
            abort(400, description=str(e))

    response = jsonify({
        'shape_id': shape_id,
        'shape_type': 'rectangle',
        'status': 'added',
        'total_shapes': total_shapes
    })
    response.status_code = 201
    return response


@app.route('/api/materials/<material_id>/add-ellipse', methods=['POST'])
def add_ellipse_shape(material_id):
    """
    Add an ellipse shape to a material map.

    Request Body:
        {
            "center_x": float,
            "center_y": float,
            "semi_major": float,
            "semi_minor": float,
            "diffusivity": float,
            "angle": float (optional, default: 0.0)
        }

    Returns:
        {
            "shape_id": str,
            "shape_type": "ellipse",
            "status": "added",
            "total_shapes": int
        }
    """
    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    try:
        center_x = data['center_x']
        center_y = data['center_y']
        semi_major = data['semi_major']
        semi_minor = data['semi_minor']
        diffusivity = data['diffusivity']
        angle = data.get('angle', 0.0)

        # Validate parameters
        if not isinstance(center_x, (int, float)):
            raise ValueError("center_x must be a number")
        if not isinstance(center_y, (int, float)):
            raise ValueError("center_y must be a number")
        if not isinstance(semi_major, (int, float)) or semi_major <= 0:
            raise ValueError("semi_major must be a positive number")
        if not isinstance(semi_minor, (int, float)) or semi_minor <= 0:
            raise ValueError("semi_minor must be a positive number")
        if not isinstance(diffusivity, (int, float)) or diffusivity <= 0:
            raise ValueError("diffusivity must be a positive number")
        if not isinstance(angle, (int, float)):
            raise ValueError("angle must be a number")

    except (KeyError, ValueError) as e:
        abort(400, description=f"Invalid parameters: {e}")

    # Keep lock during entire operation to prevent race conditions
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        try:
            shape_id = builder.add_ellipse(center_x, center_y, semi_major, semi_minor, diffusivity, angle)
            total_shapes = builder.get_shape_count()
        except ValueError as e:
            abort(400, description=str(e))

    response = jsonify({
        'shape_id': shape_id,
        'shape_type': 'ellipse',
        'status': 'added',
        'total_shapes': total_shapes
    })
    response.status_code = 201
    return response


@app.route('/api/materials/<material_id>/preview', methods=['GET'])
def get_material_map_preview(material_id):
    """
    Get the current material map as a 2D array for visualization.

    Returns:
        {
            "map_id": str,
            "material_map": [[float, ...], ...],
            "info": {...}
        }
    """
    # Keep lock during entire operation for consistency
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        material_map = builder.get_material_map()
        info = builder.get_info()

    return jsonify({
        'material_id': material_id,
        'material_map': material_map.tolist(),
        'info': info
    })


@app.route('/api/materials/<material_id>/shapes', methods=['GET'])
def get_material_shapes(material_id):
    """
    Get a list of all shapes in a material map.

    Returns:
        {
            "material_id": str,
            "shapes": [
                {
                    "shape_id": str,
                    "shape_type": str,
                    "diffusivity": float,
                    "parameters": {...},
                    "order": int
                }, ...
            ],
            "total_shapes": int
        }
    """
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        shapes = builder.get_shape_list()
        total_shapes = builder.get_shape_count()

    return jsonify({
        'material_id': material_id,
        'shapes': shapes,
        'total_shapes': total_shapes
    })


@app.route('/api/materials/<material_id>/shapes/<shape_id>', methods=['PUT'])
def update_material_shape(material_id, shape_id):
    """
    Update an existing shape's properties.

    Request Body:
        {
            "diffusivity": float (optional),
            "parameters": {...} (optional, shape-specific parameters)
        }

    Returns:
        {
            "shape_id": str,
            "status": "updated",
            "total_shapes": int
        }
    """
    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        # Find the shape
        shape_to_update = None
        for shape in builder.shapes:
            if shape.shape_id == shape_id:
                shape_to_update = shape
                break

        if not shape_to_update:
            abort(404, description=f"Shape '{shape_id}' not found.")

        try:
            # Update diffusivity if provided
            if 'diffusivity' in data:
                new_diffusivity = data['diffusivity']
                if not isinstance(new_diffusivity, (int, float)) or new_diffusivity <= 0:
                    raise ValueError("diffusivity must be a positive number")
                shape_to_update.diffusivity = new_diffusivity

            # Update parameters if provided
            if 'parameters' in data:
                new_parameters = data['parameters']
                if not isinstance(new_parameters, dict):
                    raise ValueError("parameters must be a dictionary")

                # Validate parameters based on shape type
                if shape_to_update.shape_type == 'rectangle':
                    # Validate rectangle parameters if they're being changed
                    params = {**shape_to_update.parameters, **new_parameters}
                    if not validate_rectangle_bounds(
                        builder.width, builder.height,
                        params['x'], params['y'],
                        params['width'], params['height']
                    ):
                        raise ValueError("Updated rectangle parameters extend beyond material map bounds")
                elif shape_to_update.shape_type == 'ellipse':
                    # Validate ellipse parameters if they're being changed
                    params = {**shape_to_update.parameters, **new_parameters}
                    if not validate_ellipse_bounds(
                        builder.width, builder.height,
                        params['center_x'], params['center_y'],
                        params['semi_major'], params['semi_minor']
                    ):
                        raise ValueError("Updated ellipse parameters extend beyond material map bounds")

                # Update the parameters
                shape_to_update.parameters.update(new_parameters)

            total_shapes = builder.get_shape_count()

        except (ValueError, KeyError) as e:
            abort(400, description=f"Invalid parameters: {e}")

    response = jsonify({
        'shape_id': shape_id,
        'status': 'updated',
        'total_shapes': total_shapes
    })
    response.status_code = 200
    return response


@app.route('/api/materials/<material_id>/shapes/<shape_id>', methods=['DELETE'])
def delete_material_shape(material_id, shape_id):
    """
    Delete a specific shape from a material map.

    Returns:
        {
            "shape_id": str,
            "status": "deleted",
            "total_shapes": int
        }
    """
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        success = builder.remove_shape(shape_id)
        if not success:
            abort(404, description=f"Shape '{shape_id}' not found.")

        total_shapes = builder.get_shape_count()

    response = jsonify({
        'shape_id': shape_id,
        'status': 'deleted',
        'total_shapes': total_shapes
    })
    response.status_code = 200
    return response


@app.route('/api/materials/<material_id>/shapes', methods=['DELETE'])
def clear_all_material_shapes(material_id):
    """
    Clear all shapes from a material map.

    Returns:
        {
            "material_id": str,
            "status": "cleared",
            "total_shapes": int
        }
    """
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)
        if not builder:
            abort(404, description=f"Material '{material_id}' not found.")

        builder.clear_shapes()
        total_shapes = builder.get_shape_count()  # Should be 0

    response = jsonify({
        'material_id': material_id,
        'status': 'cleared',
        'total_shapes': total_shapes
    })
    response.status_code = 200
    return response


# --- Enhanced Simulation Creation ---

@app.route('/api/simulations/with-material', methods=['POST'])
def create_simulation_from_material_map():
    """
    Starts a new simulation with custom parameters.
    Uses fixed spatial discretization (100x100 grid) and automatically calculates
    time step for numerical stability.

    Request Body:
        {
            "material_id": str,
            "total_time": float (0.1-2.0 seconds),
            "initial_temperature": float (15-25°C),
            "boundary_temperatures": {
                "left": float (0-100°C),
                "right": float (0-100°C),
                "top": float (0-100°C),
                "bottom": float (0-100°C)
            }
        }

    Returns:
        Same as /api/simulations endpoint
    """
    data = request.get_json()
    if not data:
        abort(400, description="Invalid JSON payload.")

    material_id = data.get('material_id')
    if not material_id:
        abort(400, description="Missing 'material_id' parameter.")

    # Get the material map
    with MATERIAL_MAPS_LOCK:
        builder = MATERIAL_MAPS.get(material_id)

    if not builder:
        abort(404, description=f"Material '{material_id}' not found.")

    try:
        # Extract only the user-friendly parameters
        total_time = data.get('total_time')
        initial_temperature = data.get('initial_temperature')
        boundary_temperatures = data.get('boundary_temperatures')

        # Validate parameters (same as Level 1)
        if not (0.1 <= total_time <= 2.0):
            raise ValueError("total_time must be between 0.1 and 2.0 seconds")
        if not (15 <= initial_temperature <= 25):
            raise ValueError("initial_temperature must be between 15 and 25°C")
        
        # Validate boundary temperatures
        for side in ['left', 'right', 'top', 'bottom']:
            if side not in boundary_temperatures:
                raise ValueError(f"Missing boundary temperature for '{side}'")
            temp = boundary_temperatures[side]
            if not (0 <= temp <= 100):
                raise ValueError(f"Boundary temperature for '{side}' must be between 0 and 100°C")

        # Generate the material map
        material_map = builder.get_material_map()
        height, width = material_map.shape

        # Calculate time step based on the maximum diffusivity in the material
        max_diffusivity = np.max(material_map)
        dx = 1.0 / width
        dy = 1.0 / height
        max_stable_dt = 0.25 / (max_diffusivity * (1 / dx**2 + 1 / dy**2))
        time_step = min(max_stable_dt * 0.9, 0.01)

        # Ensure we have at least 10 time steps for smooth animation
        min_time_steps = 10
        max_time_step = total_time / min_time_steps
        time_step = min(time_step, max_time_step)

        # Calculate appropriate save_interval to target ~50-100 frames for good animation
        total_timesteps = int(total_time / time_step)
        target_frames = min(100, max(20, total_timesteps // 20))  # 20-100 frames
        save_interval = max(1, total_timesteps // target_frames)

        # Create simulation config with all technical details handled automatically
        sim_config = SimulationConfig(
            width=width,
            height=height,
            total_time=total_time,
            dt=time_step,
            save_interval=save_interval,
            initial_temp=initial_temperature,
            boundary_temp_left=boundary_temperatures['left'],
            boundary_temp_right=boundary_temperatures['right'],
            boundary_temp_top=boundary_temperatures['top'],
            boundary_temp_bottom=boundary_temperatures['bottom'],
            material_map=material_map,
            heat_sources=[]
        )

    except (KeyError, ValueError) as e:
        abort(400, description=f"Invalid parameters: {e}")

    job_id = str(uuid.uuid4())

    with SIMULATION_JOBS_LOCK:
        SIMULATION_JOBS[job_id] = {'status': 'pending', 'progress': 0}

    # Start the simulation in a background thread
    thread = threading.Thread(target=run_simulation_worker, args=(job_id, sim_config))
    thread.daemon = True
    thread.start()

    with SIMULATION_JOBS_LOCK:
        SIMULATION_JOBS[job_id]['status'] = 'running'

    response = jsonify({
        'job_id': job_id,
        'status': 'running',
        'message': f'Simulation started using material {material_id}.',
        'location': f'/api/simulations/{job_id}',
        'grid_size': f'{width}x{height}',
        'time_step': round(time_step, 6)
    })
    response.status_code = 202
    response.headers['Location'] = f'/api/simulations/{job_id}'
    return response


if __name__ == '__main__':
    print("Starting Flask server for the Heat Equation Solver API...")
    print("\n=== SIMULATION API ENDPOINTS ===")

    print("\nLevel 1: Basic Simulation")
    print("  POST /api/simulations/custom                - Start simulation with custom parameters")
    print("  GET  /api/simulations/<id>/status           - Check if simulation is complete")
    print("  GET  /api/simulations/<id>/results          - Get results (supports ?frame=last or ?frame=N)")

    print("\nLevel 2: Material Design")
    print("  POST /api/materials/create                  - Create a new material design")
    print("  POST /api/materials/<id>/add-rectangle      - Add rectangle to design")
    print("  POST /api/materials/<id>/add-ellipse        - Add ellipse to design")
    print("  GET  /api/materials/<id>/preview            - Get the material map for display")
    print("  GET  /api/materials/<id>/shapes             - List all shapes in material")
    print("  PUT  /api/materials/<id>/shapes/<shape_id>  - Edit existing shape")
    print("  DELETE /api/materials/<id>/shapes/<shape_id> - Delete specific shape")
    print("  DELETE /api/materials/<id>/shapes           - Clear all shapes")
    print("  POST /api/simulations/with-material         - Run simulation with custom material")

    print("\n=== OPTIONAL/TESTING ENDPOINTS ===")
    print("  GET  /api/examples                          - Lists predefined examples")
    print("  GET  /api/examples/<name>                   - Gets example configuration")
    print("  POST /api/simulations                       - Generic simulation (accepts example or config)")

    print("\nServer is running on http://127.0.0.1:5000")
    app.run(debug=True, port=5000)

