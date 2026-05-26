"""
Material Map Builder for creating complex heterogeneous material configurations.

This module provides a MaterialMapBuilder class that manages the creation and
modification of material maps using geometric shapes. It supports sequential
shape application where later shapes override earlier ones in overlapping regions.
"""
import uuid
import numpy as np
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
import threading

from .shapes import (
    create_rectangle_mask,
    create_ellipse_mask,
    apply_shape_to_material_map,
    validate_rectangle_bounds,
    validate_ellipse_bounds
)


@dataclass
class Shape:
    """Represents a shape in the material map."""
    shape_id: str
    shape_type: str  # 'rectangle' or 'ellipse'
    diffusivity: float
    parameters: Dict[str, Any]  # Shape-specific parameters
    order: int  # Order in which shape was added (for proper layering)


class MaterialMapBuilder:
    """
    Builder class for creating material maps with geometric shapes.

    Supports adding rectangles and ellipses with different material properties.
    Shapes are applied sequentially, with later shapes overriding earlier ones
    in overlapping regions.
    """

    def __init__(self, width: int, height: int, base_diffusivity: float):
        """
        Initialize a new material map builder.

        Args:
            width: Width of the material map in grid units
            height: Height of the material map in grid units
            base_diffusivity: Base material diffusivity value

        Raises:
            ValueError: If dimensions are invalid or base_diffusivity <= 0
        """
        if width <= 0 or height <= 0:
            raise ValueError("Width and height must be positive")
        if base_diffusivity <= 0:
            raise ValueError("Base diffusivity must be positive")

        self.width = width
        self.height = height
        self.base_diffusivity = base_diffusivity
        self.shapes: List[Shape] = []
        self._shape_counter = 0
        self._lock = threading.Lock()  # For thread-safe operations

    def add_rectangle(self, x: int, y: int, rect_width: int, rect_height: int,
                     diffusivity: float) -> str:
        """
        Add a rectangular region to the material map.

        Args:
            x: X-coordinate of rectangle's top-left corner
            y: Y-coordinate of rectangle's top-left corner
            rect_width: Width of the rectangle
            rect_height: Height of the rectangle
            diffusivity: Material diffusivity for this region

        Returns:
            Shape ID (UUID string)

        Raises:
            ValueError: If parameters are invalid or shape extends beyond bounds
        """
        # Validate parameters
        if diffusivity <= 0:
            raise ValueError("Diffusivity must be positive")

        if not validate_rectangle_bounds(self.width, self.height, x, y, rect_width, rect_height):
            raise ValueError(f"Rectangle (x={x}, y={y}, w={rect_width}, h={rect_height}) "
                           f"extends beyond material map bounds ({self.width}x{self.height})")

        with self._lock:
            shape_id = str(uuid.uuid4())
            shape = Shape(
                shape_id=shape_id,
                shape_type='rectangle',
                diffusivity=diffusivity,
                parameters={
                    'x': x,
                    'y': y,
                    'width': rect_width,
                    'height': rect_height
                },
                order=self._shape_counter
            )
            self.shapes.append(shape)
            self._shape_counter += 1

        return shape_id

    def add_ellipse(self, center_x: float, center_y: float, semi_major: float,
                   semi_minor: float, diffusivity: float, angle: float = 0.0) -> str:
        """
        Add an elliptical region to the material map.

        Args:
            center_x: X-coordinate of ellipse center
            center_y: Y-coordinate of ellipse center
            semi_major: Semi-major axis length
            semi_minor: Semi-minor axis length
            diffusivity: Material diffusivity for this region
            angle: Rotation angle in radians (default: 0.0)

        Returns:
            Shape ID (UUID string)

        Raises:
            ValueError: If parameters are invalid or shape extends beyond bounds
        """
        # Validate parameters
        if diffusivity <= 0:
            raise ValueError("Diffusivity must be positive")

        if not validate_ellipse_bounds(self.width, self.height, center_x, center_y,
                                     semi_major, semi_minor):
            raise ValueError(f"Ellipse (center=({center_x}, {center_y}), "
                           f"axes=({semi_major}, {semi_minor})) extends beyond "
                           f"material map bounds ({self.width}x{self.height})")

        with self._lock:
            shape_id = str(uuid.uuid4())
            shape = Shape(
                shape_id=shape_id,
                shape_type='ellipse',
                diffusivity=diffusivity,
                parameters={
                    'center_x': center_x,
                    'center_y': center_y,
                    'semi_major': semi_major,
                    'semi_minor': semi_minor,
                    'angle': angle
                },
                order=self._shape_counter
            )
            self.shapes.append(shape)
            self._shape_counter += 1

        return shape_id

    def remove_shape(self, shape_id: str) -> bool:
        """
        Remove a shape from the material map.

        Args:
            shape_id: ID of the shape to remove

        Returns:
            True if shape was found and removed, False otherwise
        """
        with self._lock:
            for i, shape in enumerate(self.shapes):
                if shape.shape_id == shape_id:
                    self.shapes.pop(i)
                    return True
            return False

    def get_material_map(self) -> np.ndarray:
        """
        Generate the current material map with all shapes applied.

        Returns:
            2D numpy array of material diffusivity values
        """
        with self._lock:
            # Start with base material
            material_map = np.full((self.height, self.width), self.base_diffusivity,
                                 dtype=np.float64)

            # Apply shapes in order (later shapes override earlier ones)
            for shape in sorted(self.shapes, key=lambda s: s.order):
                if shape.shape_type == 'rectangle':
                    mask = create_rectangle_mask(
                        self.width, self.height,
                        shape.parameters['x'], shape.parameters['y'],
                        shape.parameters['width'], shape.parameters['height']
                    )
                elif shape.shape_type == 'ellipse':
                    mask = create_ellipse_mask(
                        self.width, self.height,
                        shape.parameters['center_x'], shape.parameters['center_y'],
                        shape.parameters['semi_major'], shape.parameters['semi_minor'],
                        shape.parameters.get('angle', 0.0)
                    )
                else:
                    continue  # Skip unknown shape types

                material_map = apply_shape_to_material_map(
                    material_map, mask, shape.diffusivity
                )

            return material_map

    def get_shape_list(self) -> List[Dict]:
        """
        Get a list of all shapes in the material map.

        Returns:
            List of shape dictionaries with metadata
        """
        with self._lock:
            return [
                {
                    'shape_id': shape.shape_id,
                    'shape_type': shape.shape_type,
                    'diffusivity': shape.diffusivity,
                    'parameters': shape.parameters.copy(),
                    'order': shape.order
                }
                for shape in sorted(self.shapes, key=lambda s: s.order)
            ]

    def get_shape_count(self) -> int:
        """Get the number of shapes in the material map."""
        with self._lock:
            return len(self.shapes)

    def clear_shapes(self) -> None:
        """Remove all shapes from the material map."""
        with self._lock:
            self.shapes.clear()
            self._shape_counter = 0

    def to_dict(self) -> Dict:
        """
        Serialize the material map builder to a dictionary.

        Returns:
            Dictionary representation suitable for JSON serialization
        """
        with self._lock:
            return {
                'width': self.width,
                'height': self.height,
                'base_diffusivity': self.base_diffusivity,
                'shapes': [asdict(shape) for shape in self.shapes],
                'shape_counter': self._shape_counter
            }

    @classmethod
    def from_dict(cls, data: Dict) -> 'MaterialMapBuilder':
        """
        Deserialize a material map builder from a dictionary.

        Args:
            data: Dictionary representation from to_dict()

        Returns:
            MaterialMapBuilder instance

        Raises:
            ValueError: If data is invalid or missing required fields
        """
        try:
            builder = cls(
                width=data['width'],
                height=data['height'],
                base_diffusivity=data['base_diffusivity']
            )

            # Restore shapes
            for shape_data in data.get('shapes', []):
                shape = Shape(**shape_data)
                builder.shapes.append(shape)

            builder._shape_counter = data.get('shape_counter', len(builder.shapes))

            return builder

        except (KeyError, TypeError) as e:
            raise ValueError(f"Invalid material map data: {e}")

    def get_info(self) -> Dict:
        """
        Get summary information about the material map.

        Returns:
            Dictionary with material map metadata
        """
        with self._lock:
            shape_types = {}
            for shape in self.shapes:
                shape_types[shape.shape_type] = shape_types.get(shape.shape_type, 0) + 1

            return {
                'width': self.width,
                'height': self.height,
                'base_diffusivity': self.base_diffusivity,
                'total_shapes': len(self.shapes),
                'shape_types': shape_types,
                'grid_size': self.width * self.height
            }