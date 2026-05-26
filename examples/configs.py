import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import matplotlib.pyplot as plt

from src.heat_solver import HeatEquationSolver, SimulationConfig, HeatSource
from src.material_map_builder import MaterialMapBuilder


def get_basic_diffusion_config() -> SimulationConfig:
    """
    Simple heat diffusion with a single central heat source.
    Perfect for testing basic GUI functionality and visualization.
    """
    return SimulationConfig(
        width=100, height=100, dx=0.01, dy=0.01,
        dt=2.50e-05, total_time=0.25, save_interval=50,
        initial_temp=20.0,
        heat_sources=[HeatSource(x=50, y=50, heating_rate=5000.0)],
        material_diffusivity=0.5
    )


def get_with_boundaries_config() -> SimulationConfig:
    """
    Heat diffusion with boundary conditions on all sides.
    Great for testing boundary condition UI controls.
    """
    return SimulationConfig(
        width=80, height=60, dx=0.01, dy=0.01,
        dt=5e-6, total_time=0.1, save_interval=25,
        initial_temp=25.0,
        boundary_temp_left=10.0, boundary_temp_right=50.0,
        boundary_temp_top=40.0, boundary_temp_bottom=5.0,
        material_diffusivity=1.2
    )


def get_simple_shapes_config() -> SimulationConfig:
    """
    Simple demonstration of shape-based material design.
    Perfect for testing the shape-based GUI functionality.
    """
    width, height = 120, 80

    # Create material map using MaterialMapBuilder
    builder = MaterialMapBuilder(width, height, base_diffusivity=0.5)

    # Add a high-conductivity rectangle
    builder.add_rectangle(
        x=40, y=30,
        rect_width=40, rect_height=20,
        diffusivity=5.0
    )

    # Add a circular heat spreader
    builder.add_ellipse(
        center_x=60.0, center_y=40.0,
        semi_major=15.0, semi_minor=15.0,
        diffusivity=10.0
    )

    material_map = builder.get_material_map()

    return SimulationConfig(
        width=width, height=height, dx=0.01, dy=0.01,
        dt=1e-6, total_time=0.05, save_interval=25,
        initial_temp=20.0,
        heat_sources=[HeatSource(x=20, y=40, heating_rate=8000.0)],
        boundary_temp_right=25.0,
        material_map=material_map
    )


def get_heat_sink_config() -> SimulationConfig:
    """
    Realistic heat sink design with fins - demonstrates complex shape layering.
    Shows how multiple rectangles can create practical engineering patterns.
    """
    width, height = 100, 100

    # Create material map - conductive base with low-conductivty gaps
    builder = MaterialMapBuilder(width, height, base_diffusivity=0.01)

    # Base plate (high conductivity material)
    conductor = 3.0
    builder.add_rectangle(x=0, y=90, rect_width=100, rect_height=10, diffusivity=conductor)

    # Heat sink fins (vertical rectangles) and point sources
    point_sources = []
    fin_positions = [10, 45, 80]
    for x_pos in fin_positions:
        builder.add_rectangle(
            x=x_pos, y=70,
            rect_width=10, rect_height=20,
            diffusivity=conductor
        )

    material_map = builder.get_material_map()

    return SimulationConfig(
        width=width, height=height, dx=0.01, dy=0.01,
        dt=1.25e-06, total_time=0.01, save_interval=100,
        initial_temp=20.0,
        heat_sources=point_sources,
        boundary_temp_bottom=50.0,
        material_map=material_map
    )


def get_thermal_barrier_config() -> SimulationConfig:
    """
    Thermal barrier demonstration - insulating material with conductive paths.
    Perfect example of how shapes override base materials in layers.
    """
    width, height = 140, 100

    # Start with high-conductivity base material
    builder = MaterialMapBuilder(width, height, base_diffusivity=3.0)

    # Add insulating barriers (low conductivity walls)
    builder.add_rectangle(x=40, y=0, rect_width=10, rect_height=100, diffusivity=0.01)
    builder.add_rectangle(x=100, y=0, rect_width=10, rect_height=100, diffusivity=0.01)

    # Add conductive gaps in the barriers (demonstrating shape layering)
    builder.add_rectangle(x=42, y=40, rect_width=6, rect_height=20, diffusivity=5.0)
    builder.add_rectangle(x=102, y=30, rect_width=6, rect_height=25, diffusivity=5.0)

    material_map = builder.get_material_map()

    return SimulationConfig(
        width=width, height=height, dx=0.01, dy=0.01,
        dt=2.50e-06, total_time=0.08, save_interval=40,
        initial_temp=20.0,
        heat_sources=[],
        boundary_temp_right=25.0,
        material_map=material_map
    )


def progress_callback(progress, state):
    progress_percent = int(progress * 100)
    
    if not hasattr(progress_callback, 'last_printed'):
        progress_callback.last_printed = -1
    
    if progress_percent > progress_callback.last_printed:
        print(f"Progress: {progress_percent}% - Time: {state['time']:.3f}s - "
              f"Mean temp: {state['mean_temp']:.2f}°C")
        progress_callback.last_printed = progress_percent

# def progress_callback(progress, state):
#     if int(progress * 100) % 10 == 0:
#         print(f"Progress: {progress*100:.0f}% - Time: {state['time']:.3f}s - "
#                 f"Mean temp: {state['mean_temp']:.2f}°C")


def example_basic_diffusion():
    """Basic heat diffusion example - single heat source, uniform material"""
    print("Running basic diffusion example...")

    config = get_basic_diffusion_config()
    solver = HeatEquationSolver(config)
    history = solver.run(progress_callback=progress_callback)
    print(f"Simulation complete. Saved {len(history)} snapshots.")
    return history


def example_with_boundaries():
    """Example with boundary conditions - perfect for testing UI boundary controls"""
    print("Running example with boundaries...")

    config = get_with_boundaries_config()
    solver = HeatEquationSolver(config)
    history = solver.run(progress_callback=progress_callback)
    print(f"Simulation complete. Saved {len(history)} snapshots.")
    return history


def example_simple_shapes():
    """Simple shape-based design - rectangle and circle overlays"""
    print("Running simple shapes example...")

    config = get_simple_shapes_config()
    solver = HeatEquationSolver(config)
    history = solver.run(progress_callback=progress_callback)
    print(f"Simulation complete. Saved {len(history)} snapshots.")

    # Show material map
    print('Plotting material profile and final heat distribution')
    material_map = config.material_map
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    fig.suptitle("Simple Shape-Based Material Design", fontsize=16)

    im1 = ax1.imshow(material_map, cmap='viridis', interpolation='nearest')
    ax1.set_title("Material Thermal Diffusivity (α)")
    ax1.axis('off')
    fig.colorbar(im1, ax=ax1, label='α (m²/s)', shrink=0.8)

    final_state = history[-1]
    grid = np.array(final_state['grid'])
    vmin = np.min([h['min_temp'] for h in history])
    vmax = np.max([h['max_temp'] for h in history])

    im2 = ax2.imshow(grid, cmap='hot', interpolation='nearest', vmin=vmin, vmax=vmax)
    ax2.set_title(f"Final Heat Distribution (t = {final_state['time']:.3f}s)")
    ax2.axis('off')
    fig.colorbar(im2, ax=ax2, label='Temperature (°C)', shrink=0.8)
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    plt.show()

    return history


def example_heat_sink():
    """Heat sink example - practical engineering application with multiple rectangles"""
    print("Running heat sink example...")

    config = get_heat_sink_config()
    plt.figure(figsize=(8, 6))
    plt.suptitle("Heat Sink Material Map", fontsize=16)
    im1 = plt.imshow(config.material_map, cmap='plasma', interpolation='nearest')
    plt.axis('off')
    plt.colorbar(im1, label='Thermal Diffusivity (m²/s)', shrink=0.8)
    plt.tight_layout()
    plt.show()

    solver = HeatEquationSolver(config)
    history = solver.run(progress_callback=progress_callback)
    print(f"Simulation complete. Saved {len(history)} snapshots.")

    # Show material map and results
    print('Plotting heat sink design and thermal performance')
    final_state = history[-1]
    grid = np.array(final_state['grid'])
    vmin = np.min([h['min_temp'] for h in history])
    vmax = np.max([h['max_temp'] for h in history])

    plt.figure(figsize=(8, 6))
    plt.suptitle(f"Temperature Distribution (t = {final_state['time']:.3f}s)", fontsize=16)
    im2 = plt.imshow(grid, cmap='hot', interpolation='nearest', vmin=vmin, vmax=vmax)
    plt.axis('off')
    plt.colorbar(im2, label='Temperature (°C)', shrink=0.8)
    plt.tight_layout()
    plt.show()

    return history


def example_thermal_barrier():
    """Thermal barrier example - demonstrates shape layering and material override"""
    print("Running thermal barrier example...")

    config = get_thermal_barrier_config()
    solver = HeatEquationSolver(config)
    history = solver.run(progress_callback=progress_callback)
    print(f"Simulation complete. Saved {len(history)} snapshots.")

    # Show the layering effect
    print('Plotting thermal barrier design showing shape layering')
    material_map = config.material_map
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle("Thermal Barrier with Conductive Paths", fontsize=16)

    im1 = ax1.imshow(material_map, cmap='RdYlBu_r', interpolation='nearest')
    ax1.set_title("Material Configuration (Layered Shapes)")
    ax1.axis('off')
    fig.colorbar(im1, ax=ax1, label='Thermal Diffusivity (m²/s)', shrink=0.8)

    final_state = history[-1]
    grid = np.array(final_state['grid'])
    vmin = np.min([h['min_temp'] for h in history])
    vmax = np.max([h['max_temp'] for h in history])

    im2 = ax2.imshow(grid, cmap='hot', interpolation='nearest', vmin=vmin, vmax=vmax)
    ax2.set_title(f"Heat Flow Through Barriers (t = {final_state['time']:.3f}s)")
    ax2.axis('off')
    fig.colorbar(im2, ax=ax2, label='Temperature (°C)', shrink=0.8)
    plt.tight_layout(rect=[0, 0, 1, 0.96])
    plt.show()

    return history


