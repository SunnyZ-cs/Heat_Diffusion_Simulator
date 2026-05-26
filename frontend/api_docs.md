# Heat Simulator API Documentation
‌​​​​​​​​​‌​‌‌​​‌‌‌​‌​​​‌‌‌​​‌‌‌‌‌‌‌‌​‌​‌​​​​​​​‌‌‌​​‌​​‌​​​‌‌​‌
Complete API reference for building the frontend GUI.

**Base URL:** `http://127.0.0.1:5000/api`

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Understanding Coordinates & Data](#understanding-coordinates--data)
3. [Level 1: Basic Simulation](#level-1-basic-simulation)
4. [Level 2: Material Design](#level-2-material-design)
5. [Advanced Shape Management](#advanced-shape-management)
6. [Quick Reference](#quick-reference)

---

## Quick Start

### Starting the Backend

```bash
python src/api.py
```

The server will start on `http://127.0.0.1:5000` and display all available endpoints.

### Testing the API

```bash
# Test the API is running
curl http://127.0.0.1:5000/api/examples

# Expected response: ["basic_diffusion", "with_boundaries", ...]
```

---

## Understanding Coordinates & Data

### Grid System Overview

The simulation uses a **100×100 grid** representing a **1m × 1m** physical domain.

```
Grid Coordinates:
(0,0) ──────────────────────→ X (100)
  │
  │        (30, 25)
  │           ●
  │
  ↓
  Y (100)

Array Indexing (Programming):
grid[row][column] = grid[y][x]

// To get temperature at coordinate (30, 25):
const temp = grid[25][30]; // Note: Y first, then X!
```

---

## Level 1: Basic Simulation

Build a basic heat simulator with custom parameters and playback controls.

### Start Simulation

**Endpoint:** `POST /api/simulations/custom`

Creates a simulation with your custom parameters. The backend automatically handles grid size and time step calculations.

**Request:**
```http
POST /api/simulations/custom
Content-Type: application/json

{
  "total_time": 2.0,
  "initial_temperature": 20.0,
  "boundary_temperatures": {
    "left": 100.0,
    "right": 0.0,
    "top": 50.0,
    "bottom": 50.0
  },
  "diffusivity": 1.0
}
```

**Parameters:**

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `total_time` | float | 0.1 - 2.0 | How long to simulate (seconds) |
| `initial_temperature` | float | 15 - 25 | Starting temperature everywhere (°C) |
| `boundary_temperatures.left` | float | 0 - 100 | Temperature kept constant at left edge (°C) |
| `boundary_temperatures.right` | float | 0 - 100 | Temperature kept constant at right edge (°C) |
| `boundary_temperatures.top` | float | 0 - 100 | Temperature kept constant at top edge (°C) |
| `boundary_temperatures.bottom` | float | 0 - 100 | Temperature kept constant at bottom edge (°C) |
| `diffusivity` | float | 0.01 - 10.0 | Material thermal diffusivity |

**Response (202 Accepted):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "message": "Custom simulation started.",
  "location": "/api/simulations/550e8400-e29b-41d4-a716-446655440000",
  "grid_size": "100x100",
  "time_step": 0.000025
}
```

### Check Status

**Endpoint:** `GET /api/simulations/{job_id}/status`

Monitor your simulation progress. **Poll this every 500-1000ms** until status is "completed".

**Request:**
```http
GET /api/simulations/550e8400-e29b-41d4-a716-446655440000/status
```

**Response - Still Running:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "progress": 67.5,
  "error": null
}
```

**Response - Completed:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 100,
  "error": null,
  "results_location": "/api/simulations/550e8400-e29b-41d4-a716-446655440000/results",
  "frame_count": 81
}
```

**Status Values:**
- `"pending"` → Job queued, not started yet
- `"running"` → Simulation in progress
- `"completed"` → Ready to fetch results
- `"failed"` → Something went wrong (check `error` field)

### Get Results

**Endpoint:** `GET /api/simulations/{job_id}/results`

Fetch individual frames for smooth playback. **Always fetch frames individually** for better performance.

**Get Specific Frame:**
```http
GET /api/simulations/550e8400-e29b-41d4-a716-446655440000/results?frame=0
```

**Get Last Frame:**
```http
GET /api/simulations/550e8400-e29b-41d4-a716-446655440000/results?frame=last
```

**Frame Response:**
```json
{
  "time": 0.5,
  "timestep": 20000,
  "grid": [
    [20.0, 20.5, 21.0, 21.2, ...],
    [20.3, 22.1, 23.5, 24.1, ...],
    ...
  ],
  "min_temp": 0.0,
  "max_temp": 100.0,
  "mean_temp": 35.4
}
```

**Grid Data Explanation:**
```javascript
// The grid is a 2D array: grid[row][column] = grid[y][x]
const temperatureData = response.grid;

// To access temperature at visual position (x=30, y=25):
const temp = temperatureData[25][30]; // Row 25, Column 30

// Grid dimensions are always 100x100:
console.log(temperatureData.length);        // 100 rows (height)
console.log(temperatureData[0].length);     // 100 columns (width)
```

---

## Level 2: Material Design

Design custom materials with different thermal properties using geometric shapes.

### Create Material

**Endpoint:** `POST /api/materials/create`

Start a new material design with a base diffusivity (background material).

**Request:**
```http
POST /api/materials/create
Content-Type: application/json

{
  "width": 100,
  "height": 100,
  "base_diffusivity": 0.01
}
```

**Response (201 Created):**
```json
{
  "material_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "created",
  "info": {
    "width": 100,
    "height": 100,
    "base_diffusivity": 0.01,
    "total_shapes": 0,
    "shape_types": {},
    "grid_size": 10000
  }
}
```

### Add Rectangle

**Endpoint:** `POST /api/materials/{material_id}/add-rectangle`

Add a rectangular region with different thermal properties.

**Request:**
```http
POST /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/add-rectangle
Content-Type: application/json

{
  "x": 25,
  "y": 40,
  "rect_width": 50,
  "rect_height": 20,
  "diffusivity": 10.0
}
```

**Rectangle Coordinate System:**
```
Grid (100×100):
(0,0) ──────────────────────→ X
  │
  │     (25,40) ┌─────────────┐ (75,40)
  │             │  Rectangle  │
  │             │  50×20      │
  │     (25,60) └─────────────┘ (75,60)
  ↓
  Y

Parameters:
- x=25, y=40     (top-left corner)
- width=50       (extends from x=25 to x=75)
- height=20      (extends from y=40 to y=60)
```

**Bounds Validation:**
- Rectangle must fit within grid: `x + rect_width ≤ 100` and `y + rect_height ≤ 100`
- All coordinates must be non-negative
- Width and height must be positive

**Response (201 Created):**
```json
{
  "shape_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "shape_type": "rectangle",
  "status": "added",
  "total_shapes": 1
}
```

### Add Ellipse

**Endpoint:** `POST /api/materials/{material_id}/add-ellipse`

Add an elliptical region with different thermal properties.

**Request:**
```http
POST /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/add-ellipse
Content-Type: application/json

{
  "center_x": 50.0,
  "center_y": 50.0,
  "semi_major": 20.0,
  "semi_minor": 10.0,
  "angle": 45.0,
  "diffusivity": 5.0
}
```

**Ellipse Parameters:**
- `center_x`, `center_y`: Center point of the ellipse
- `semi_major`: Half the length of the longest diameter
- `semi_minor`: Half the length of the shortest diameter
- `angle`: Rotation in degrees (0-360, optional, default: 0)
- `diffusivity`: Material property for this region

**Response (201 Created):**
```json
{
  "shape_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "shape_type": "ellipse",
  "status": "added",
  "total_shapes": 2
}
```

### Preview Material

**Endpoint:** `GET /api/materials/{material_id}/preview`

Get the final material map for visualization before running simulation.

**Request:**
```http
GET /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/preview
```

**Response (200 OK):**
```json
{
  "material_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "material_map": [
    [0.01, 0.01, 0.01, ...],
    [10.0, 10.0, 10.0, ...],
    [0.01, 5.0, 5.0, ...],
    ...
  ],
  "info": {
    "width": 100,
    "height": 100,
    "base_diffusivity": 0.01,
    "total_shapes": 2,
    "shape_types": {
      "rectangle": 1,
      "ellipse": 1
    }
  }
}
```

**Shape Layering Rules:**
- **Later shapes override earlier shapes** where they overlap
- Base material (0.01) shows where no shapes are placed
- Each cell contains the diffusivity value of the topmost shape

### Run Simulation with Material

**Endpoint:** `POST /api/simulations/with-material`

Run a simulation using your custom material design.

**Request:**
```http
POST /api/simulations/with-material
Content-Type: application/json

{
  "material_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "total_time": 2.0,
  "initial_temperature": 20.0,
  "boundary_temperatures": {
    "left": 100.0,
    "right": 0.0,
    "top": 50.0,
    "bottom": 50.0
  }
}
```

**Response:** Same format as Level 1 - returns a `job_id` to track progress.

---

## Advanced Shape Management

These optional endpoints provide additional functionality for managing shapes within material designs. They support advanced features like editing existing shapes, maintaining shape lists, and implementing "Clear All" functionality.

### List All Shapes

**Endpoint:** `GET /api/materials/{material_id}/shapes`

Get a complete list of all shapes in a material design, including their properties and layering order.

**Request:**
```http
GET /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/shapes
```

**Response (200 OK):**
```json
{
  "material_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "shapes": [
    {
      "shape_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "shape_type": "rectangle",
      "diffusivity": 10.0,
      "parameters": {
        "x": 25,
        "y": 40,
        "rect_width": 50,
        "rect_height": 20
      },
      "order": 0
    },
    {
      "shape_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "shape_type": "ellipse",
      "diffusivity": 5.0,
      "parameters": {
        "center_x": 50.0,
        "center_y": 50.0,
        "semi_major": 20.0,
        "semi_minor": 10.0,
        "angle": 45.0
      },
      "order": 1
    }
  ],
  "total_shapes": 2
}
```

**Shape Order:**
- `order` field indicates layering priority (0 = first added, higher = more recent)
- Higher order shapes override lower order shapes where they overlap

### Update Shape Properties

**Endpoint:** `PUT /api/materials/{material_id}/shapes/{shape_id}`

Modify an existing shape's properties. Useful for implementing edit functionality in the object tree.

**Request:**
```http
PUT /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/shapes/a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json

{
  "diffusivity": 15.0,
  "parameters": {
    "x": 30,
    "y": 35,
    "rect_width": 40,
    "rect_height": 25
  }
}
```

**Parameters:**
- `diffusivity` (optional): New thermal diffusivity value
- `parameters` (optional): Shape-specific parameters to update
  - **Rectangle**: `x`, `y`, `rect_width`, `rect_height`
  - **Ellipse**: `center_x`, `center_y`, `semi_major`, `semi_minor`, `angle`

**Response (200 OK):**
```json
{
  "shape_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "updated",
  "total_shapes": 2
}
```

### Delete Specific Shape

**Endpoint:** `DELETE /api/materials/{material_id}/shapes/{shape_id}`

Remove a single shape from the material design.

**Request:**
```http
DELETE /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/shapes/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response (200 OK):**
```json
{
  "shape_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "deleted",
  "total_shapes": 1
}
```

### Clear All Shapes

**Endpoint:** `DELETE /api/materials/{material_id}/shapes`

Remove all shapes from a material design, resetting it to the base material only. Perfect for implementing a "Clear All" button.

**Request:**
```http
DELETE /api/materials/7c9e6679-7425-40de-944b-e07fc1f90ae7/shapes
```

**Response (200 OK):**
```json
{
  "material_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "cleared",
  "total_shapes": 0
}
```

### Implementation Tips

**Object Tree Features:**
- Use `GET /shapes` to populate shape lists with edit/delete buttons
- Use `PUT /shapes/{id}` to implement inline editing
- Use `DELETE /shapes/{id}` for individual shape removal
- Use `DELETE /shapes` for bulk "Clear All" functionality

**Shape Management Workflow:**
1. **Add shapes** using Level 2 endpoints (`add-rectangle`, `add-ellipse`)
2. **List shapes** to show in object tree (`GET /shapes`)
3. **Edit shapes** when user clicks edit button (`PUT /shapes/{id}`)
4. **Delete shapes** individually or in bulk (`DELETE /shapes/{id}` or `DELETE /shapes`)
5. **Preview material** to see visual changes (`GET /preview`)

---

## Quick Reference

### Parameter Ranges
- **total_time**: 0.1 - 2.0 seconds
- **initial_temperature**: 15 - 25°C
- **boundary_temperatures**: 0 - 100°C each
- **diffusivity**: 0.01 - 10.0

### API Format
- **Base URL**: `http://127.0.0.1:5000/api`
- **Data Format**: All requests and responses use JSON
- **Content-Type**: `application/json` (required for POST requests)

### Status Values
- `"pending"` → Queued
- `"running"` → In progress
- `"completed"` → Ready
- `"failed"` → Error occurred

### Grid System
- **Size**: Always 100×100
- **Indexing**: `grid[row][column]` = `grid[y][x]`
- **Origin**: (0,0) at top-left

### Color Scale Recommendations
- **Temperature**: Blue → Cyan → Green → Yellow → Red
- **Materials**: Dark (insulator) → Bright (conductor)
