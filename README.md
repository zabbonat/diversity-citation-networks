# Rao-Stirling Network Visualization

An interactive web-based network visualization tool for analyzing JEL classification codes weighted by Rao-Stirling diversity indices. Designed for scientometric research examining interdisciplinarity patterns in academic publications.

## Features

- **Interactive Force-Directed Graph**: Drag, zoom, and pan through the network
- **Dynamic Filtering**: Filter by year range, minimum RS value, and component types
- **Color-Coded Categories**: Theoretical (red), Methodological (blue), Cross-domain (green)
- **Node Sizing**: Proportional to appearance frequency
- **Edge Weighting**: Line thickness reflects cumulative RS values
- **Hover Tooltips**: Detailed information on each JEL code
- **CSV Export**: Download network data for further analysis
- **Dark Theme**: Professional visualization aesthetic

## Quick Start

### Option 1: Standalone HTML (No Installation)

Simply open `standalone.html` in any modern web browser. This version includes all dependencies inline and requires no build process.

```bash
# On macOS
open standalone.html

# On Linux
xdg-open standalone.html

# On Windows
start standalone.html
```

### Option 2: Development Build (React + Vite)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Data Format

Your input file must be a tab-separated (TSV) or comma-separated (CSV) file with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `theoretical` | List | JEL codes representing theoretical domains |
| `methodological` | List | JEL codes representing methodological approaches |
| `cross` | List of tuples | Cross-domain code pairs (methodological, theoretical) |
| `rao_stirling_theoretical` | Float | RS diversity index for theoretical combination |
| `rao_stirling_methodological` | Float | RS diversity index for methodological combination |
| `rao_stirling_cross` | Float | RS diversity index for cross-domain linkages |
| `publication_year` | Integer | Year of publication |

### Example Data Format

```
	theoretical	methodological	cross	rao_stirling_theoretical	rao_stirling_methodological	rao_stirling_cross	publication_year
0	['G13', 'G12']	['C15', 'C53', 'C13']	[('C15', 'G13'), ('C53', 'G12')]	0.5	0.27	-0.57	2009
1	['E44', 'G12']	['C52', 'C51']	[('C52', 'E44'), ('C51', 'G12')]	0.36	0.46	-0.53	2010
```

## Interface Controls

### Filter Panel

- **Component Types**: Toggle visibility of theoretical, methodological, and cross-domain nodes
- **Year Range**: Specify the temporal window for analysis
- **Min Rao-Stirling**: Set minimum diversity threshold (0.0 - 0.8)
- **Top N Combinations**: Limit number of combinations per component type

### Network Interactions

- **Drag**: Click and drag nodes to reposition
- **Zoom**: Scroll wheel or pinch gesture
- **Pan**: Click and drag on empty space
- **Hover**: Display detailed node information
- **Click**: (In React version) Open detail panel

## Project Structure

```
rao_stirling_network_app/
├── index.html              # Vite entry point
├── package.json            # Dependencies and scripts
├── vite.config.js          # Vite configuration
├── standalone.html         # Single-file version (no build required)
├── README.md               # This file
└── src/
    ├── main.jsx           # React entry point
    ├── App.jsx            # Main application component
    └── index.css          # Styles
```

## Customization

### Modifying Colors

Edit the `colorScale` object in the visualization code:

```javascript
const colorScale = {
  theoretical: '#ef5350',    // Red
  methodological: '#42a5f5', // Blue
  cross: '#66bb6a'           // Green
};
```

### Adjusting Force Parameters

Modify the D3 force simulation settings:

```javascript
simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(edges).distance(80).strength(0.3))
  .force('charge', d3.forceManyBody().strength(-150))
  .force('collision', d3.forceCollide().radius(d => nodeSize(d.count) + 5));
```

### Node Size Scaling

Adjust the size scale range:

```javascript
const nodeSize = d3.scaleSqrt()
  .domain([1, maxCount])
  .range([4, 25]); // [minSize, maxSize]
```

## Technical Details

### Dependencies

- **D3.js v7**: Force-directed graph layout and SVG manipulation
- **React 18**: Component-based UI (development version)
- **Vite 5**: Build tooling (development version)

### Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Methodology

The visualization implements a force-directed graph algorithm where:

1. **Nodes** represent individual JEL classification codes
2. **Edges** connect codes that appear in the same publication
3. **Edge weights** accumulate Rao-Stirling diversity values
4. **Node categories** are determined by their primary usage context

The Rao-Stirling diversity index measures the variety and disparity of knowledge combinations, with higher values indicating greater interdisciplinarity.

## Citation

If you use this visualization tool in your research, please cite appropriately and reference the underlying Rao-Stirling diversity methodology:

> Stirling, A. (2007). A general framework for analysing diversity in science, technology and society. *Journal of the Royal Society Interface*, 4(15), 707-719.

## License

MIT License - See LICENSE file for details.
