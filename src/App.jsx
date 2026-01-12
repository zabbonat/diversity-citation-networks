import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';

// ============================================================================
// JEL CODE DESCRIPTIONS (parsed from XML)
// ============================================================================

const JEL_DESCRIPTIONS = {};

// Function to parse XML and extract JEL descriptions
const parseJELXml = async () => {
  try {
    const response = await fetch('./classificationTreeJELCODE.xml');
    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const classifications = xmlDoc.querySelectorAll('classification');
    classifications.forEach(cls => {
      const code = cls.querySelector(':scope > code')?.textContent;
      const desc = cls.querySelector(':scope > description')?.textContent;
      if (code && desc) {
        // Clean up HTML entities
        JEL_DESCRIPTIONS[code] = desc
          .replace(/&bull;/g, '•')
          .replace(/&ndash;/g, '–')
          .replace(/&amp;/g, '&');
      }
    });
  } catch (e) {
    console.log('Could not load JEL descriptions:', e);
  }
};

// Component display names (Thematic instead of Theoretical)
const COMPONENT_DISPLAY_NAMES = {
  theoretical: 'Thematic',
  methodological: 'Methodological',
  cross: 'Cross-domain'
};

// ============================================================================
// DATA PROCESSING UTILITIES
// ============================================================================

const parseListString = (str) => {
  if (!str || str === '[]') return [];
  try {
    const cleaned = str
      .replace(/\(/g, '[')
      .replace(/\)/g, ']')
      .replace(/'/g, '"');
    return JSON.parse(cleaned);
  } catch (e) {
    return [];
  }
};

const processData = (rawData) => {
  try {
    const data = d3.csvParse(rawData, (d, i) => {
      const obj = { ...d };

      // Parse list string columns
      ['theoretical', 'methodological', 'cross'].forEach(col => {
        if (d[col]) {
          obj[col] = parseListString(d[col]);
        } else {
          obj[col] = [];
        }
      });

      // Parse numeric columns
      Object.keys(d).forEach(key => {
        if (key.includes('rao_stirling') || key === 'publication_year' || key.includes('citation_')) {
          obj[key] = parseFloat(d[key]) || 0;
        }
      });

      obj.id = i;
      return obj;
    });
    console.log('Processed data length:', data.length);
    if (data.length > 0) console.log('First row:', data[0]);
    return data;
  } catch (e) {
    console.error('Error parsing CSV:', e);
    return [];
  }
};

// Calculate quantile value from array
const quantile = (arr, q) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
};

// Get citation column name based on window
const getCitationColumn = (citationWindow) => {
  return `citation_${citationWindow}`;
};

// Calculate beta coefficient (simplified - using RS value sign as proxy)
const calculateBeta = (rsValue) => {
  return rsValue; // Using RS value directly as effect indicator
};

// Get effect classification
const getEffectClass = (beta) => {
  if (beta > 0.05) return { label: 'PREMIUM', color: '#4caf50' };
  if (beta < -0.05) return { label: 'PENALTY', color: '#ef5350' };
  return { label: 'NEUTRAL', color: '#9e9e9e' };
};

const buildNetworkData = (data, filters, citationWindow, quantileValue) => {
  const { yearRange, minRS, componentTypes, topN } = filters;
  const citationCol = getCitationColumn(citationWindow);

  let filtered = data.filter(d =>
    d.publication_year >= yearRange[0] &&
    d.publication_year <= yearRange[1]
  );

  const nodeMap = new Map();
  const edgeMap = new Map();

  componentTypes.forEach(component => {
    const rsCol = `rao_stirling_${component}`;

    const sorted = [...filtered]
      .filter(d => {
        const codes = d[component];
        const rs = component === 'cross' ? Math.abs(d[rsCol]) : d[rsCol];
        return codes && codes.length > 0 && rs >= minRS;
      })
      .sort((a, b) => {
        const rsA = component === 'cross' ? Math.abs(a[rsCol]) : a[rsCol];
        const rsB = component === 'cross' ? Math.abs(b[rsCol]) : b[rsCol];
        return rsB - rsA;
      })
      .slice(0, topN);

    sorted.forEach(row => {
      const codes = row[component];
      const rs = component === 'cross' ? Math.abs(row[rsCol]) : row[rsCol];
      const year = row.publication_year;
      const citation = row[citationCol] || 0;
      const beta = calculateBeta(row[rsCol]);

      if (component === 'cross') {
        codes.forEach(pair => {
          if (Array.isArray(pair) && pair.length === 2) {
            const [methCode, theoCode] = pair;

            if (!nodeMap.has(methCode)) {
              nodeMap.set(methCode, {
                id: methCode, category: 'methodological',
                totalRS: 0, count: 0, years: new Set(), citations: []
              });
            }
            const methNode = nodeMap.get(methCode);
            methNode.totalRS += rs;
            methNode.count += 1;
            methNode.years.add(year);
            methNode.citations.push(citation);

            if (!nodeMap.has(theoCode)) {
              nodeMap.set(theoCode, {
                id: theoCode, category: 'theoretical',
                totalRS: 0, count: 0, years: new Set(), citations: []
              });
            }
            const theoNode = nodeMap.get(theoCode);
            theoNode.totalRS += rs;
            theoNode.count += 1;
            theoNode.years.add(year);
            theoNode.citations.push(citation);

            const edgeKey = [methCode, theoCode].sort().join('--');
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, {
                source: methCode, target: theoCode,
                weight: 0, type: 'cross', count: 0, betas: []
              });
            }
            const edge = edgeMap.get(edgeKey);
            edge.weight += rs;
            edge.count += 1;
            edge.betas.push(beta);
          }
        });
      } else {
        codes.forEach(code => {
          if (!nodeMap.has(code)) {
            nodeMap.set(code, {
              id: code, category: component,
              totalRS: 0, count: 0, years: new Set(), citations: []
            });
          }
          const node = nodeMap.get(code);
          node.totalRS += rs;
          node.count += 1;
          node.years.add(year);
          node.citations.push(citation);
        });

        for (let i = 0; i < codes.length; i++) {
          for (let j = i + 1; j < codes.length; j++) {
            const edgeKey = [codes[i], codes[j]].sort().join('--');
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, {
                source: codes[i], target: codes[j],
                weight: 0, type: component, count: 0, betas: []
              });
            }
            const edge = edgeMap.get(edgeKey);
            edge.weight += rs;
            edge.count += 1;
            edge.betas.push(beta);
          }
        }
      }
    });
  });

  const nodes = Array.from(nodeMap.values()).map(n => ({
    ...n,
    years: Array.from(n.years),
    avgRS: n.totalRS / n.count,
    citationAtQuantile: n.citations.length > 0 ? quantile(n.citations, quantileValue) : 0
  }));

  const edges = Array.from(edgeMap.values()).map(e => ({
    ...e,
    avgBeta: e.betas.length > 0 ? e.betas.reduce((a, b) => a + b, 0) / e.betas.length : 0
  }));

  return { nodes, edges };
};

// ============================================================================
// QUANTILE EXPLORER COMPONENT
// ============================================================================

const QuantileExplorer = ({
  citationWindow,
  setCitationWindow,
  quantileValue,
  setQuantileValue,
  currentEffect
}) => {
  const effectClass = getEffectClass(currentEffect);

  return (
    <div className="filter-section quantile-explorer">
      <h3>⚙ QUANTILE EXPLORER</h3>

      <div className="filter-group">
        <label>Citation Window</label>
        <div className="radio-group">
          {['1years', '3years', '5years'].map(window => (
            <div key={window} className="radio-item">
              <input
                type="radio"
                id={`window-${window}`}
                name="citationWindow"
                checked={citationWindow === window}
                onChange={() => setCitationWindow(window)}
              />
              <label htmlFor={`window-${window}`}>
                {window.replace('years', '-year')}
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label>▶ QUANTILE SLIDER</label>
        <div className="quantile-display">τ = {quantileValue.toFixed(2)}</div>
        <input
          type="range"
          min="0.10"
          max="0.90"
          step="0.01"
          value={quantileValue}
          onChange={(e) => setQuantileValue(parseFloat(e.target.value))}
          className="quantile-slider"
        />
        <div className="quantile-range-labels">
          <span>0.10</span>
          <span>0.90</span>
        </div>
      </div>

      <div className="filter-group">
        <label>Current Effect</label>
        <div className="effect-display-box" style={{ borderColor: effectClass.color }}>
          <div className="effect-value">
            {currentEffect >= 0 ? '+' : ''}{currentEffect.toFixed(2)}
          </div>
          <div className="effect-bar-container">
            <div
              className="effect-bar"
              style={{
                width: `${Math.min(Math.abs(currentEffect) * 100, 100)}%`,
                backgroundColor: effectClass.color
              }}
            />
          </div>
          <div className="effect-label" style={{ color: effectClass.color }}>
            {effectClass.label}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// FILTER PANEL COMPONENT
// ============================================================================

const FilterPanel = ({
  filters, setFilters, stats, availableYears,
  citationWindow, setCitationWindow, quantileValue, setQuantileValue, currentEffect
}) => {
  const handleYearChange = (idx, value) => {
    const newRange = [...filters.yearRange];
    newRange[idx] = parseInt(value);
    setFilters({ ...filters, yearRange: newRange });
  };

  const handleComponentToggle = (component) => {
    const current = filters.componentTypes;
    const newTypes = current.includes(component)
      ? current.filter(c => c !== component)
      : [...current, component];
    setFilters({ ...filters, componentTypes: newTypes });
  };

  return (
    <div className="filter-panel">
      <div className="stats-box">
        <div className="stat">
          <span className="stat-label">Nodes</span>
          <span className="stat-value">{stats.nodes}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Edges</span>
          <span className="stat-value">{stats.edges}</span>
        </div>
      </div>

      <QuantileExplorer
        citationWindow={citationWindow}
        setCitationWindow={setCitationWindow}
        quantileValue={quantileValue}
        setQuantileValue={setQuantileValue}
        currentEffect={currentEffect}
      />

      <div className="filter-section">
        <h3>⚙ FILTERS</h3>

        <div className="filter-group">
          <label>Year Range</label>
          <div className="year-range">
            <input
              type="number"
              value={filters.yearRange[0]}
              onChange={(e) => handleYearChange(0, e.target.value)}
              min={2009}
              max={2019}
            />
            <span>-</span>
            <input
              type="number"
              value={filters.yearRange[1]}
              onChange={(e) => handleYearChange(1, e.target.value)}
              min={2009}
              max={2019}
            />
          </div>
        </div>

        <div className="filter-group">
          <label>Component Types</label>
          {['theoretical', 'methodological', 'cross'].map(comp => (
            <div key={comp} className="checkbox-item">
              <input
                type="checkbox"
                id={comp}
                checked={filters.componentTypes.includes(comp)}
                onChange={() => handleComponentToggle(comp)}
              />
              <label htmlFor={comp}>
                <span className={`color-dot ${comp}`}></span>
                {COMPONENT_DISPLAY_NAMES[comp]}
              </label>
            </div>
          ))}
        </div>

        <div className="filter-group">
          <label>Min Rao-Stirling: {filters.minRS.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="0.8"
            step="0.01"
            value={filters.minRS}
            onChange={(e) => setFilters({ ...filters, minRS: parseFloat(e.target.value) })}
          />
        </div>

        <div className="filter-group">
          <label>Top N Combinations: {filters.topN}</label>
          <input
            type="range"
            min="10"
            max="200"
            step="10"
            value={filters.topN}
            onChange={(e) => setFilters({ ...filters, topN: parseInt(e.target.value) })}
          />
        </div>
      </div>

      <div className="filter-section">
        <h3>LEGEND</h3>

        <div className="legend-subsection">
          <div className="legend-title">Edge Color (Effect):</div>
          <div className="legend-item">
            <span className="edge-line penalty"></span>
            <span>Red = Penalty (β &lt; 0)</span>
          </div>
          <div className="legend-item">
            <span className="edge-line neutral"></span>
            <span>Grey = Neutral (β ≈ 0)</span>
          </div>
          <div className="legend-item">
            <span className="edge-line premium"></span>
            <span>Green = Premium (β &gt; 0)</span>
          </div>
        </div>

        <div className="legend-subsection">
          <div className="legend-title">Node Color:</div>
          <div className="legend-item">
            <span className="color-dot theoretical"></span>
            <span>Thematic</span>
          </div>
          <div className="legend-item">
            <span className="color-dot methodological"></span>
            <span>Methodological</span>
          </div>
        </div>

        <div className="legend-note">
          Node size = Citation count at quantile τ
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// NODE TOOLTIP COMPONENT
// ============================================================================

const Tooltip = ({ node, position }) => {
  if (!node) return null;

  const jelDescription = JEL_DESCRIPTIONS[node.id] || 'No description available';

  return (
    <div
      className="tooltip"
      style={{ left: position.x + 15, top: position.y - 10 }}
    >
      <div className="tooltip-header">{node.id}</div>
      <div className="tooltip-description">{jelDescription}</div>
      <div className="tooltip-row">
        <span>Category:</span>
        <span className={node.category}>
          {COMPONENT_DISPLAY_NAMES[node.category] || node.category}
        </span>
      </div>
      <div className="tooltip-row">
        <span>Appearances:</span>
        <span>{node.count}</span>
      </div>
      <div className="tooltip-row">
        <span>Citation at τ:</span>
        <span>{node.citationAtQuantile?.toFixed(0) || 0}</span>
      </div>
      <div className="tooltip-row">
        <span>Avg RS Value:</span>
        <span>{node.avgRS?.toFixed(4)}</span>
      </div>
    </div>
  );
};

// ============================================================================
// NETWORK GRAPH COMPONENT
// ============================================================================

const NetworkGraph = ({ nodes, edges, onNodeHover, onNodeClick }) => {
  const svgRef = useRef();

  useEffect(() => {
    if (!nodes.length) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll('*').remove();
    const g = svg.append('g');

    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    const colorScale = {
      theoretical: '#ef5350',
      methodological: '#42a5f5',
      cross: '#66bb6a'
    };

    // Edge color based on beta
    const getEdgeColor = (beta) => {
      if (beta > 0.05) return '#4caf50';
      if (beta < -0.05) return '#ef5350';
      return '#9e9e9e';
    };

    const maxCitation = Math.max(...nodes.map(n => n.citationAtQuantile || 1), 1);
    const nodeSize = d3.scaleSqrt().domain([0, maxCitation]).range([4, 30]);

    const maxWeight = Math.max(...edges.map(e => e.weight), 1);
    const edgeWidth = d3.scaleLinear().domain([0, maxWeight]).range([0.5, 4]);

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(80).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-150).distanceMax(300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => nodeSize(d.citationAtQuantile || 0) + 5));

    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('stroke', d => getEdgeColor(d.avgBeta))
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => edgeWidth(d.weight));

    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        }));

    node.append('circle')
      .attr('r', d => nodeSize(d.citationAtQuantile || 0))
      .attr('fill', d => colorScale[d.category])
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .on('mouseover', (event, d) => {
        onNodeHover(d, { x: event.pageX, y: event.pageY });
        d3.select(event.currentTarget).attr('stroke-width', 3);
      })
      .on('mouseout', (event) => {
        onNodeHover(null, { x: 0, y: 0 });
        d3.select(event.currentTarget).attr('stroke-width', 1.5);
      })
      .on('click', (event, d) => onNodeClick(d));

    node.append('text')
      .text(d => d.id)
      .attr('x', d => nodeSize(d.citationAtQuantile || 0) + 3)
      .attr('y', 3)
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .attr('font-weight', 'bold')
      .style('pointer-events', 'none');

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    setTimeout(() => {
      svg.call(zoom.transform, d3.zoomIdentity.translate(width / 4, height / 4).scale(0.8));
    }, 100);

    return () => simulation.stop();
  }, [nodes, edges, onNodeHover, onNodeClick]);

  return <svg ref={svgRef} className="network-svg"></svg>;
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const App = () => {
  const [processedData, setProcessedData] = useState([]);
  const [networkData, setNetworkData] = useState({ nodes: [], edges: [] });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableYears] = useState([2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]);

  // Quantile Explorer state
  const [citationWindow, setCitationWindow] = useState('5years');
  const [quantileValue, setQuantileValue] = useState(0.50);
  const [currentEffect, setCurrentEffect] = useState(0);

  const [filters, setFilters] = useState({
    yearRange: [2009, 2019],
    minRS: 0.0,
    topN: 50,
    componentTypes: ['theoretical', 'methodological', 'cross']
  });

  // Load JEL descriptions and data on mount
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      // Load JEL descriptions
      await parseJELXml();

      // Load the data file
      try {
        const response = await fetch('./data_perNetwork.csv');
        const text = await response.text();
        const processed = processData(text);
        setProcessedData(processed);
      } catch (e) {
        console.error('Error loading data:', e);
      }
      setIsLoading(false);
    };
    loadData();
  }, []);

  useEffect(() => {
    if (processedData.length > 0) {
      const network = buildNetworkData(processedData, filters, citationWindow, quantileValue);
      setNetworkData(network);

      // Calculate current effect (average beta across all edges)
      if (network.edges.length > 0) {
        const avgBeta = network.edges.reduce((sum, e) => sum + e.avgBeta, 0) / network.edges.length;
        setCurrentEffect(avgBeta);
      }
    }
  }, [processedData, filters, citationWindow, quantileValue]);



  const handleNodeHover = useCallback((node, position) => {
    setHoveredNode(node);
    setTooltipPosition(position);
  }, []);

  const handleNodeClick = useCallback((node) => setSelectedNode(node), []);

  const stats = { nodes: networkData.nodes.length, edges: networkData.edges.length };

  return (
    <div className="app">
      <FilterPanel
        filters={filters}
        setFilters={setFilters}
        stats={stats}
        availableYears={availableYears}
        citationWindow={citationWindow}
        setCitationWindow={setCitationWindow}
        quantileValue={quantileValue}
        setQuantileValue={setQuantileValue}
        currentEffect={currentEffect}
      />

      <div className="main-content">
        {isLoading ? (
          <div className="loading-prompt">
            <h2>Diversity Citation Networks</h2>
            <p>Loading data...</p>
          </div>
        ) : (
          <NetworkGraph
            nodes={networkData.nodes}
            edges={networkData.edges}
            onNodeHover={handleNodeHover}
            onNodeClick={handleNodeClick}
          />
        )}
      </div>

      <Tooltip node={hoveredNode} position={tooltipPosition} />

      {selectedNode && (
        <div className="node-detail-panel">
          <button className="close-btn" onClick={() => setSelectedNode(null)}>×</button>
          <h3>{selectedNode.id}</h3>
          <p className="node-description">{JEL_DESCRIPTIONS[selectedNode.id] || 'No description'}</p>
          <div className="detail-row">
            <span>Category:</span>
            <span className={`badge ${selectedNode.category}`}>
              {COMPONENT_DISPLAY_NAMES[selectedNode.category]}
            </span>
          </div>
          <div className="detail-row">
            <span>Appearances:</span>
            <span>{selectedNode.count}</span>
          </div>
          <div className="detail-row">
            <span>Citation at τ:</span>
            <span>{selectedNode.citationAtQuantile?.toFixed(0)}</span>
          </div>
          <div className="detail-row">
            <span>Average RS:</span>
            <span>{selectedNode.avgRS?.toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
