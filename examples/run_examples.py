#!/usr/bin/env python3
"""
Example usage of the Heat Equation Solver
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
import json
import os

from examples.configs import (
    example_basic_diffusion,
    example_with_boundaries,
    example_simple_shapes,
    example_heat_sink,
    example_thermal_barrier,
)


def visualize_results(history, title="Heat Distribution"):
    """Visualize simulation results"""
    fig, axes = plt.subplots(2, 3, figsize=(12, 8))
    fig.suptitle(title)

    # Select 6 evenly spaced snapshots
    indices = np.linspace(0, len(history)-1, 6, dtype=int)

    for ax, idx in zip(axes.flat, indices):
        state = history[idx]
        grid = np.array(state['grid'])

        im = ax.imshow(grid, cmap='hot', interpolation='nearest',
                      vmin=np.min([h['min_temp'] for h in history]),
                      vmax=np.max([h['max_temp'] for h in history]))
        ax.set_title(f"t = {state['time']:.3f}s")
        ax.axis('off')

    plt.colorbar(im, ax=axes.ravel().tolist(), label='Temperature (°C)')
    # plt.tight_layout()
    plt.show()


def save_results_to_json(history, filename="simulation_results.json"):
    """Save simulation results to JSON file"""
    with open(filename, 'w') as f:
        json.dump(history, f, indent=2)
    print(f"Results saved to {filename}")


def create_animation(history, filename="heat_animation.gif"):
    """Create an animation of the simulation"""
    print(f"Creating animation...")

    fig, ax = plt.subplots(figsize=(8, 8))

    # Get temperature range for consistent colormap
    all_grids = [np.array(state['grid']) for state in history]
    vmin = min(grid.min() for grid in all_grids)
    vmax = max(grid.max() for grid in all_grids)

    # Initial plot
    im = ax.imshow(all_grids[0], cmap='hot', vmin=vmin, vmax=vmax,
                   interpolation='nearest')
    title = ax.set_title(f"Time: {history[0]['time']:.3f}s")
    ax.axis('off')
    plt.colorbar(im, ax=ax, label='Temperature (°C)')

    def update(frame):
        im.set_array(all_grids[frame])
        title.set_text(f"Time: {history[frame]['time']:.3f}s")
        return [im, title]

    anim = FuncAnimation(
        fig, 
        update, 
        frames=len(history),
        interval=100, 
        blit=True
        )

    anim.save(filename, writer='pillow')
    print(f"Animation saved to {filename}")
    plt.close()


def main():
    """Run examples"""
    print("Heat Equation Solver Examples\n" + "="*40)

    dir_output = os.path.join(os.getcwd(), 'output')
    os.makedirs(dir_output, exist_ok=True)

    # Choose which example to run
    examples = {
        '1': ('Basic Diffusion', example_basic_diffusion),
        '2': ('With Boundaries', example_with_boundaries),
        '3': ('Simple Shapes', example_simple_shapes),
        '4': ('Heat Sink Design', example_heat_sink),
        '5': ('Thermal Barrier', example_thermal_barrier)
    }

    print("\nAvailable examples:")
    for key, (name, _) in examples.items():
        print(f"  {key}. {name}")

    choice = input("\nSelect example (1-5) or 'all': ").strip()

    if choice == 'all':
        for name, func in examples.values():
            print(f"\n{name}")
            print("-" * len(name))
            history = func()
            visualize_results(history, title=name)
            if input("Create animation? (y/n): ").lower() == 'y':
                create_animation(history, filename=os.path.join(dir_output, f'{name}.gif'))

    elif choice in examples:
        name, func = examples[choice]
        history = func()

        # Visualize results
        visualize_results(history, title=name)

        # Option to save
        if input("\nSave results to JSON? (y/n): ").lower() == 'y':
            save_results_to_json(history, filename=os.path.join(dir_output, f'{name}.json'))

        if input("Create animation? (y/n): ").lower() == 'y':
            create_animation(history, filename=os.path.join(dir_output, f'{name}.gif'))
    else:
        print("Invalid choice")

if __name__ == "__main__":
    main()