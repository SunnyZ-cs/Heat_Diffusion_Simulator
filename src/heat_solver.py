"""
2D Heat Equation Solver using Finite Difference Method with Forward Euler
"""
import numpy as np
from typing import Dict, List, Optional
from dataclasses import dataclass, field


@dataclass
class HeatSource:
    """Represents a heat source in the simulation domain"""
    x: int
    y: int

    # This represents a source term in the heat equation (units: degrees/sec)
    heating_rate: float
    start_time: float = 0.0
    end_time: Optional[float] = None  # if None then always active

    def is_active(self, time: float) -> bool:
        """Check if source is active at given time"""
        if time < self.start_time:
            return False
        if self.end_time is not None and time > self.end_time:
            return False
        return True

@dataclass
class SimulationConfig:
    """Configuration for a heat simulation"""
    # Domain parameters
    width: int = 100
    height: int = 100
    dx: float = 0.01
    dy: float = 0.01

    # Time parameters
    dt: float = 0.001
    total_time: float = 1.0
    save_interval: int = 10

    # Initial conditions
    initial_temp: float = 20.0

    # Boundary conditions (Dirichlet)
    boundary_temp_left: Optional[float] = None
    boundary_temp_right: Optional[float] = None
    boundary_temp_top: Optional[float] = None
    boundary_temp_bottom: Optional[float] = None

    heat_sources: List[HeatSource] = field(default_factory=list)

    material_diffusivity: float = 1.0
    
    # This is a NumPy array of shape (height, width) storing α for each cell.
    # If None, a uniform map is created from material_diffusivity.
    material_map: Optional[np.ndarray] = None

    def __post_init__(self):
        if self.material_map is None:
            self.material_map = np.full(
                (self.height, self.width),
                self.material_diffusivity,
                dtype=np.float64
            )
        elif self.material_map.shape != (self.height, self.width):
            raise ValueError("Shape of material_map must match (height, width)")

        # Stability check uses the MAXIMUM diffusivity in the domain
        max_alpha = np.max(self.material_map)
        if max_alpha == 0:
            return
            
        # The stability condition is: α * dt * (1/dx² + 1/dy²) <= 0.25
        stability_val = max_alpha * self.dt * (1 / self.dx**2 + 1 / self.dy**2)

        if stability_val > 0.25:
            suggested_dt = 0.25 / (max_alpha * (1 / self.dx**2 + 1 / self.dy**2))
            raise ValueError(
                f"Unstable configuration. Stability criterion is {stability_val:.4f}, must be <= 0.25. "
                f"With max_alpha={max_alpha:.4f}, try reducing dt to at most {suggested_dt:.2e}."
            )


class HeatEquationSolver:
    """2D Heat Equation Solver using Finite Difference Method"""
    
    def __init__(self, config: SimulationConfig):
        self.config = config
        self.grid = np.full((config.height, config.width),
                           config.initial_temp, dtype=np.float64)
        self.time = 0.0
        self.timestep = 0
        self.history = []

        self.source_grid = np.zeros_like(self.grid)

        alpha_map = self.config.material_map
        self.rx_grid = alpha_map * config.dt / (config.dx ** 2)
        self.ry_grid = alpha_map * config.dt / (config.dy ** 2)
        
    def apply_boundary_conditions(self):
        """Apply Dirichlet boundary conditions"""
        if self.config.boundary_temp_left is not None:
            self.grid[:, 0] = self.config.boundary_temp_left
        if self.config.boundary_temp_right is not None:
            self.grid[:, -1] = self.config.boundary_temp_right
        if self.config.boundary_temp_top is not None:
            self.grid[0, :] = self.config.boundary_temp_top
        if self.config.boundary_temp_bottom is not None:
            self.grid[-1, :] = self.config.boundary_temp_bottom
    
    def update_active_sources(self):
        """Update the source grid based on which sources are active at the current time"""
        self.source_grid.fill(0)
        for source in self.config.heat_sources:
            if source.is_active(self.time):
                if 0 <= source.y < self.config.height and 0 <= source.x < self.config.width:
                    self.source_grid[source.y, source.x] = source.heating_rate

    def step(self):
        """Perform one timestep using a vectorized Forward Euler method"""
        self.update_active_sources()
        new_grid = self.grid.copy()

        interior_grid = self.grid[1:-1, 1:-1]
        laplacian_x = self.grid[1:-1, 2:] - 2 * interior_grid + self.grid[1:-1, :-2]
        laplacian_y = self.grid[2:, 1:-1] - 2 * interior_grid + self.grid[:-2, 1:-1]

        new_grid[1:-1, 1:-1] += \
            (self.rx_grid[1:-1, 1:-1] * laplacian_x) + \
            (self.ry_grid[1:-1, 1:-1] * laplacian_y) + \
            (self.config.dt * self.source_grid[1:-1, 1:-1])

        self.grid = new_grid
        self.apply_boundary_conditions()

        # Update time
        self.time += self.config.dt
        self.timestep += 1
    
    def should_save_state(self) -> bool:
        """Check if current state should be saved"""
        return self.timestep % self.config.save_interval == 0
    
    def get_state(self) -> Dict:
        """Get current simulation state"""
        return {
            'time': float(self.time),
            'timestep': int(self.timestep),
            'grid': self.grid.tolist(),
            'min_temp': float(np.min(self.grid)),
            'max_temp': float(np.max(self.grid)),
            'mean_temp': float(np.mean(self.grid))
        }
    
    def run(self, progress_callback=None) -> List[Dict]:
        """Run the complete simulation"""
        total_steps = int(self.config.total_time / self.config.dt)
        
        # Save initial state
        self.history = [self.get_state()]
        
        for step_num in range(total_steps):
            self.step()
            
            
            if self.should_save_state():
                self.history.append(self.get_state())
            
            # Progress callback for real-time updates
            if progress_callback:
                progress = (step_num + 1) / total_steps
                progress_callback(progress, self.get_state())
        
        # Ensure final state is saved
        if self.history[-1]['timestep'] != self.timestep:
            self.history.append(self.get_state())
        
        return self.history

