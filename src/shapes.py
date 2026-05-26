"""
Shape generation functions for creating material map regions.

This module provides functions to create geometric shapes (rectangles, ellipses)
as boolean masks that can be applied to material maps for heterogeneous material
configurations in heat simulations.
"""
import numpy as np
from typing import Tuple


def create_rectangle_mask(width: int, height: int, x: int, y: int,
                         rect_width: int, rect_height: int) -> np.ndarray:
    """
    Create a boolean mask for a rectangular region.

    Args:
        width: Total width of the material map
        height: Total height of the material map
        x: X-coordinate of the rectangle's top-left corner
        y: Y-coordinate of the rectangle's top-left corner
        rect_width: Width of the rectangle
        rect_height: Height of the rectangle

    Returns:
        Boolean numpy array of shape (height, width) where True indicates
        the rectangle region

    Raises:
        ValueError: If rectangle extends beyond the material map boundaries
    """
    if not validate_rectangle_bounds(width, height, x, y, rect_width, rect_height):
        raise ValueError(f"Rectangle (x={x}, y={y}, w={rect_width}, h={rect_height}) "
                        f"extends beyond material map bounds ({width}x{height})")

    mask = np.zeros((height, width), dtype=bool)

    # Apply rectangle mask - note that numpy uses [row, col] indexing
    x_end = min(x + rect_width, width)
    y_end = min(y + rect_height, height)
    mask[y:y_end, x:x_end] = True

    return mask


def create_ellipse_mask(width: int, height: int, center_x: float, center_y: float,
                       semi_major: float, semi_minor: float, angle: float = 0.0) -> np.ndarray:
    """
    Create a boolean mask for an elliptical region.

    Args:
        width: Total width of the material map
        height: Total height of the material map
        center_x: X-coordinate of the ellipse center
        center_y: Y-coordinate of the ellipse center
        semi_major: Semi-major axis length
        semi_minor: Semi-minor axis length
        angle: Rotation angle in radians (default: 0.0)

    Returns:
        Boolean numpy array of shape (height, width) where True indicates
        the ellipse region

    Raises:
        ValueError: If ellipse parameters are invalid
    """
    if not validate_ellipse_bounds(width, height, center_x, center_y, semi_major, semi_minor):
        raise ValueError(f"Ellipse (center=({center_x}, {center_y}), axes=({semi_major}, {semi_minor})) "
                        f"extends beyond material map bounds ({width}x{height})")

    if semi_major <= 0 or semi_minor <= 0:
        raise ValueError("Semi-major and semi-minor axes must be positive")

    # Create coordinate grids
    y_coords, x_coords = np.mgrid[0:height, 0:width]

    # Translate to ellipse center
    x_centered = x_coords - center_x
    y_centered = y_coords - center_y

    # Apply rotation if specified
    if angle != 0.0:
        cos_angle = np.cos(angle)
        sin_angle = np.sin(angle)
        x_rot = x_centered * cos_angle + y_centered * sin_angle
        y_rot = -x_centered * sin_angle + y_centered * cos_angle
        x_centered, y_centered = x_rot, y_rot

    # Calculate ellipse equation: (x/a)² + (y/b)² <= 1
    ellipse_eq = (x_centered / semi_major) ** 2 + (y_centered / semi_minor) ** 2
    mask = ellipse_eq <= 1.0

    return mask


def validate_rectangle_bounds(width: int, height: int, x: int, y: int,
                             rect_width: int, rect_height: int) -> bool:
    """
    Validate that a rectangle fits within the material map boundaries.

    Args:
        width: Material map width
        height: Material map height
        x, y: Rectangle top-left corner
        rect_width, rect_height: Rectangle dimensions

    Returns:
        True if rectangle is valid, False otherwise
    """
    if x < 0 or y < 0:
        return False
    if rect_width <= 0 or rect_height <= 0:
        return False
    if x + rect_width > width or y + rect_height > height:
        return False
    return True


def validate_ellipse_bounds(width: int, height: int, center_x: float, center_y: float,
                           semi_major: float, semi_minor: float) -> bool:
    """
    Validate that an ellipse fits within the material map boundaries.

    Args:
        width: Material map width
        height: Material map height
        center_x, center_y: Ellipse center coordinates
        semi_major, semi_minor: Ellipse axis lengths

    Returns:
        True if ellipse is valid, False otherwise
    """
    if center_x < 0 or center_y < 0:
        return False
    if center_x >= width or center_y >= height:
        return False
    if semi_major <= 0 or semi_minor <= 0:
        return False

    # Check if ellipse extends beyond boundaries (approximate check)
    if (center_x - semi_major < 0 or center_x + semi_major >= width or
        center_y - semi_minor < 0 or center_y + semi_minor >= height):
        return False

    return True


def apply_shape_to_material_map(material_map: np.ndarray, mask: np.ndarray,
                               diffusivity: float) -> np.ndarray:
    """
    Apply a shape mask to a material map with the specified diffusivity value.

    Args:
        material_map: Existing material map array
        mask: Boolean mask defining the shape region
        diffusivity: Material diffusivity value to apply in the masked region

    Returns:
        Updated material map with the shape applied
    """
    if material_map.shape != mask.shape:
        raise ValueError("Material map and mask must have the same shape")

    if diffusivity <= 0:
        raise ValueError("Material diffusivity must be positive")

    # Create a copy to avoid modifying the original
    updated_map = material_map.copy()
    updated_map[mask] = diffusivity

    return updated_map


def create_material_map_with_shapes(width: int, height: int, base_diffusivity: float,
                                   shapes: list) -> np.ndarray:
    """
    Create a material map by applying a sequence of shapes.

    Args:
        width: Material map width
        height: Material map height
        base_diffusivity: Base material diffusivity value
        shapes: List of shape dictionaries with keys:
               - 'type': 'rectangle' or 'ellipse'
               - shape-specific parameters
               - 'diffusivity': material diffusivity value

    Returns:
        Material map array with all shapes applied

    Example:
        shapes = [
            {
                'type': 'rectangle',
                'x': 10, 'y': 20, 'width': 50, 'height': 30,
                'diffusivity': 2.0
            },
            {
                'type': 'ellipse',
                'center_x': 75, 'center_y': 50,
                'semi_major': 20, 'semi_minor': 15,
                'diffusivity': 0.1
            }
        ]
    """
    # Initialize with base material
    material_map = np.full((height, width), base_diffusivity, dtype=np.float64)

    # Apply each shape in sequence (later shapes override earlier ones)
    for shape in shapes:
        shape_type = shape.get('type')
        diffusivity = shape.get('diffusivity')

        if diffusivity is None or diffusivity <= 0:
            raise ValueError(f"Invalid diffusivity value: {diffusivity}")

        if shape_type == 'rectangle':
            mask = create_rectangle_mask(
                width, height,
                shape['x'], shape['y'],
                shape['width'], shape['height']
            )
        elif shape_type == 'ellipse':
            mask = create_ellipse_mask(
                width, height,
                shape['center_x'], shape['center_y'],
                shape['semi_major'], shape['semi_minor'],
                shape.get('angle', 0.0)
            )
        else:
            raise ValueError(f"Unknown shape type: {shape_type}")

        material_map = apply_shape_to_material_map(material_map, mask, diffusivity)

    return material_map