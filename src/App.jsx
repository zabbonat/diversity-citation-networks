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
      // Parse list string columns
      ['theoretical', 'methodological', 'cross'].forEach(col => {
        if (d[col]) {
          // Normalize JEL codes: C5 -> C50
          const normalize = (c) => (typeof c === 'string' && /^[A-Z]\d$/.test(c)) ? c + '0' : c;

          const list = parseListString(d[col]);
          if (col === 'cross') {
            obj[col] = list.map(pair => Array.isArray(pair) ? pair.map(normalize) : pair);
          } else {
            obj[col] = list.map(normalize);
          }
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
  const { yearRange, minRS_theoretical, minRS_methodological, minRS_cross, componentTypes, topN } = filters;
  const citationCol = getCitationColumn(citationWindow);

  let filtered = data.filter(d =>
    d.publication_year >= yearRange[0] &&
    d.publication_year <= yearRange[1]
  );

  const nodeMap = new Map();
  const edgeMap = new Map();
  const combinations = [];

  const getOrCreateNode = (code, defaultCategory) => {
    if (!nodeMap.has(code)) {
      nodeMap.set(code, {
        id: code,
        category: defaultCategory,
        totalRS: 0, count: 0,
        rs_theoretical: 0, count_theoretical: 0,
        rs_methodological: 0, count_methodological: 0,
        rs_cross: 0, count_cross: 0,
        years: new Set(), citations: []
      });
    }
    return nodeMap.get(code);
  };

  componentTypes.forEach(component => {
    const rsCol = `rao_stirling_${component}`;
    // Dynamic minRS selection
    const minRS = filters[`minRS_${component}`] || 0;

    const sorted = [...filtered]
      .filter(d => {
        const codes = d[component];
        const rs = d[rsCol];
        // FIX: Filter by magnitude so negative values (penalties) are not excluded
        return codes && codes.length > 0 && Math.abs(rs) >= minRS;
      })
      .sort((a, b) => {
        const rsA = a[rsCol];
        const rsB = b[rsCol];
        // FIX: Sort by magnitude to rank strong negative effects correctly
        return Math.abs(rsB) - Math.abs(rsA);
      })
      .slice(0, topN);

    sorted.forEach(row => {
      const codes = row[component];
      const rs = row[rsCol];
      const year = row.publication_year;
      const citation = row[citationCol] || 0;

      // Store combination for analysis
      if (Array.isArray(codes) && codes.length >= 2) {
        // Flatten for cross to get all unique codes involved
        const flatCodes = component === 'cross'
          ? [...new Set(codes.flat())].sort()
          : [...codes].sort();

        combinations.push({
          id: flatCodes.join('+'),
          codes: flatCodes,
          type: component,
          citation: citation,
          year: year
        });
      }

      // FIX: Reverting to original RS value (allowing negative) as requested by user
      const beta = calculateBeta(rs);

      if (component === 'cross') {
        codes.forEach(pair => {
          if (Array.isArray(pair) && pair.length === 2) {
            const [methCode, theoCode] = pair;

            const methNode = getOrCreateNode(methCode, 'methodological');
            methNode.totalRS += rs;
            methNode.count += 1;
            methNode.rs_cross += rs;
            methNode.count_cross += 1;
            methNode.years.add(year);
            methNode.citations.push(citation);

            const theoNode = getOrCreateNode(theoCode, 'theoretical');
            theoNode.totalRS += rs;
            theoNode.count += 1;
            theoNode.rs_cross += rs;
            theoNode.count_cross += 1;
            theoNode.years.add(year);
            theoNode.citations.push(citation);

            const edgeKey = [methCode, theoCode].sort().join('--');
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, {
                source: methCode, target: theoCode,
                weight: 0, type: 'cross', count: 0, betas: [], citations: []
              });
            }
            const edge = edgeMap.get(edgeKey);
            edge.weight += rs;
            edge.count += 1;
            edge.betas.push(beta);
            edge.citations.push(citation);
          }
        });
      } else {
        codes.forEach(code => {
          const node = getOrCreateNode(code, component);
          node.totalRS += rs;
          node.count += 1;
          node[`rs_${component}`] += rs;
          node[`count_${component}`] += 1;
          node.years.add(year);
          node.citations.push(citation);
        });

        for (let i = 0; i < codes.length; i++) {
          for (let j = i + 1; j < codes.length; j++) {
            const edgeKey = [codes[i], codes[j]].sort().join('--');
            if (!edgeMap.has(edgeKey)) {
              edgeMap.set(edgeKey, {
                source: codes[i], target: codes[j],
                weight: 0, type: component, count: 0, betas: [], citations: []
              });
            }
            const edge = edgeMap.get(edgeKey);
            edge.weight += rs;
            edge.count += 1;
            edge.betas.push(beta);
            edge.citations.push(citation);
          }
        }
      }
    });
  });

  const nodes = Array.from(nodeMap.values()).map(n => ({
    ...n,
    years: Array.from(n.years),
    avgRS: n.totalRS / n.count,
    avgRS_theoretical: n.count_theoretical ? n.rs_theoretical / n.count_theoretical : 0,
    avgRS_methodological: n.count_methodological ? n.rs_methodological / n.count_methodological : 0,
    avgRS_cross: n.count_cross ? n.rs_cross / n.count_cross : 0,
    citationAtQuantile: n.citations.length > 0 ? quantile(n.citations, quantileValue) : 0
  }));

  const edges = Array.from(edgeMap.values()).map(e => {
    const citAtQ = e.citations.length > 0 ? quantile(e.citations, quantileValue) : 0;
    return {
      ...e,
      avgBeta: e.betas.length > 0 ? e.betas.reduce((a, b) => a + b, 0) / e.betas.length : 0,
      avgCitations: e.citations.length > 0 ? e.citations.reduce((a, b) => a + b, 0) / e.citations.length : 0,
      citationAtQuantile: citAtQ
    };
  });

  return { nodes, edges, combinations };
};

// ============================================================================
// HELP MODAL COMPONENT
// ============================================================================

const HelpModal = ({ onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal-content" onClick={e => e.stopPropagation()}>
      <button className="close-btn" onClick={onClose}>×</button>
      <h2>📖 How to Interpret</h2>

      <div className="help-section">
        <h3>1. Quantile Explorer (The Slider)</h3>
        <p>The slider allows you to analyze papers based on their citation impact.</p>
        <div className="visual-guide">
          <div className="guide-item">
            <span className="guide-label">τ = 0.10</span>
            <span className="guide-desc">Focuses on ALL papers (even low cited)</span>
          </div>
          <div className="guide-arrow">➜ Move Right ➜</div>
          <div className="guide-item">
            <span className="guide-label">τ = 0.90</span>
            <span className="guide-desc">Focuses only on TOP CITED papers</span>
          </div>
        </div>
      </div>

      <div className="help-section">
        <h3>2. Edge Colors (Beta Coefficient)</h3>
        <p>Colors indicate whether combining two topics leads to more or fewer citations than expected.</p>
        <ul className="color-guide">
          <li>
            <span className="dot-sample green"></span>
            <strong>Green (Premium):</strong> Good combination! These topics appear together in highly cited papers.
          </li>
          <li>
            <span className="dot-sample grey"></span>
            <strong>Grey (Neutral):</strong> Standard combination. No strong positive or negative effect.
          </li>
          <li>
            <span className="dot-sample red"></span>
            <strong>Red (Penalty):</strong> Riskier combination! These topics serve a niche or are harder to publish in top journals.
          </li>
        </ul>
      </div>

      <div className="help-section">
        <h3>3. Node Types</h3>
        <ul className="node-guide">
          <li>
            <span className="dot-sample red-node"></span>
            <strong>Thematic (Red):</strong> The topic/subject of the study (e.g., "Labor Economics").
          </li>
          <li>
            <span className="dot-sample blue-node"></span>
            <strong>Methodological (Blue):</strong> The tools used (e.g., "Econometrics").
          </li>
        </ul>
      </div>
    </div>
  </div>
);

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
  const [localQuantile, setLocalQuantile] = useState(quantileValue);

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuantileValue(localQuantile);
    }, 200); // 200ms delay
    return () => clearTimeout(timer);
  }, [localQuantile, setQuantileValue]);

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
        <div className="quantile-display">τ = {localQuantile.toFixed(2)}</div>
        <input
          type="range"
          min="0.10"
          max="0.90"
          step="0.01"
          value={localQuantile}
          onChange={(e) => setLocalQuantile(parseFloat(e.target.value))}
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
// TOP COMBINATIONS MODAL
// ============================================================================

const TopCombinationsModal = ({ edges, onClose }) => {
  const sorted = [...edges]
    .filter(e => e.avgCitations > 0)
    .sort((a, b) => b.avgCitations - a.avgCitations)
    .slice(0, 5);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>×</button>
        <h2>🏆 Top 5 Combinations</h2>
        <p className="subtitle">Ranking by Average Citations Received</p>

        <div className="combinations-list">
          {sorted.length === 0 ? (
            <p>No combinations found for current filters.</p>
          ) : (
            sorted.map((edge, i) => (
              <div key={i} className="combination-item">
                <div className="rank">#{i + 1}</div>
                <div className="pair-info">
                  <strong>{edge.source.id || edge.source} ↔ {edge.target.id || edge.target}</strong>
                  <span className={`comp-tag ${edge.type}`}>{COMPONENT_DISPLAY_NAMES[edge.type]}</span>
                </div>
                <div className="metric-value">
                  {edge.avgCitations.toFixed(1)} <small>avg cit.</small>
                </div>
              </div>
            ))
          )}
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
  citationWindow, setCitationWindow, quantileValue, setQuantileValue, currentEffect,
  onOpenHelp, onOpenAnalysis
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
      <button className="help-btn" onClick={onOpenHelp}>
        📖 How to Interpret
      </button>

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
          <button className="help-btn analysis-btn" onClick={onOpenAnalysis}>
            🏆 Show Top Clusters
          </button>
        </div>

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
          <label>Min RS: Theoretical ({filters.minRS_theoretical.toFixed(2)})</label>
          <input type="range" min="0" max="0.8" step="0.01" value={filters.minRS_theoretical}
            onChange={(e) => setFilters({ ...filters, minRS_theoretical: parseFloat(e.target.value) })}
            disabled={!filters.componentTypes.includes('theoretical')}
          />
        </div>

        <div className="filter-group">
          <label>Min RS: Methodological ({filters.minRS_methodological.toFixed(2)})</label>
          <input type="range" min="0" max="0.8" step="0.01" value={filters.minRS_methodological}
            onChange={(e) => setFilters({ ...filters, minRS_methodological: parseFloat(e.target.value) })}
            disabled={!filters.componentTypes.includes('methodological')}
          />
        </div>

        <div className="filter-group">
          <label>Min RS: Cross ({filters.minRS_cross.toFixed(2)})</label>
          <input type="range" min="0" max="0.8" step="0.01" value={filters.minRS_cross}
            onChange={(e) => setFilters({ ...filters, minRS_cross: parseFloat(e.target.value) })}
            disabled={!filters.componentTypes.includes('cross')}
          />
        </div>

        <div className="filter-group">
          <label>Max Top RS Entries Analyzed: {filters.topN}</label>
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
      {node.avgRS_theoretical > 0 && (
        <div className="tooltip-row">
          <span>RS Thematic:</span>
          <span>{node.avgRS_theoretical.toFixed(4)}</span>
        </div>
      )}
      {node.avgRS_methodological > 0 && (
        <div className="tooltip-row">
          <span>RS Method.:</span>
          <span>{node.avgRS_methodological.toFixed(4)}</span>
        </div>
      )}
      {node.avgRS_cross > 0 && (
        <div className="tooltip-row">
          <span>RS Cross:</span>
          <span>{node.avgRS_cross.toFixed(4)}</span>
        </div>
      )}
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
// TOP CLUSTERS MODAL
// ============================================================================

const TopClustersModal = ({ combinations, onClose }) => {
  // Group by unique combination ID
  const groups = new Map();

  if (combinations) {
    combinations.forEach(c => {
      if (!groups.has(c.id)) {
        groups.set(c.id, {
          id: c.id,
          codes: c.codes,
          type: c.type,
          count: 0,
          totalCit: 0,
          citations: []
        });
      }
      const g = groups.get(c.id);
      g.count += 1;
      g.totalCit += c.citation;
      g.citations.push(c.citation);
    });
  }

  const sortedClusters = Array.from(groups.values())
    .map(g => ({
      ...g,
      avgCit: g.count > 0 ? g.totalCit / g.count : 0
    }))
    .sort((a, b) => b.avgCit - a.avgCit)
    .slice(0, 10); // Show Top 10

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>×</button>
        <h2>🏆 Top Combinations (Itemsets)</h2>
        <p className="subtitle">Ranking by Average Citations of Co-occurring Codes</p>

        <div className="combinations-list">
          {sortedClusters.length === 0 ? (
            <p>No combinations found for current filters.</p>
          ) : (
            sortedClusters.map((cluster, i) => (
              <div key={i} className="combination-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                  <div className="rank">#{i + 1}</div>
                  <div className="metric-value">
                    {cluster.avgCit.toFixed(1)} <small>avg cit.</small>
                    <span style={{ fontSize: '0.8em', color: '#666', marginLeft: '8px' }}>
                      (freq: {cluster.count})
                    </span>
                  </div>
                </div>
                <div className="cluster-edges" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {cluster.codes.map((code, j) => (
                    <span key={j} className={`badge ${cluster.type}`} style={{ fontSize: '0.9em' }}>
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================

const App = () => {
  const [processedData, setProcessedData] = useState([]);
  const [networkData, setNetworkData] = useState({ nodes: [], edges: [], combinations: [] });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [availableYears] = useState([2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]);

  // Quantile Explorer state
  const [citationWindow, setCitationWindow] = useState('5years');
  const [quantileValue, setQuantileValue] = useState(0.50);
  const [currentEffect, setCurrentEffect] = useState(0);

  const [filters, setFilters] = useState({
    yearRange: [2010, 2019],
    minRS_theoretical: 0.0,
    minRS_methodological: 0.0,
    minRS_cross: 0.0,
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

      // Calculate current effect (weighted average beta by citation count at quantile)
      if (network.edges.length > 0) {
        // Weighted average: Sum(Beta * Citations) / Sum(Citations)
        // If total citations is 0, fallback to simple average
        let totalWeightedBeta = 0;
        let totalWeight = 0;

        network.edges.forEach(e => {
          const weight = e.citationAtQuantile || 1; // Use 1 as minimum weight to avoid zero div if all are 0
          totalWeightedBeta += e.avgBeta * weight;
          totalWeight += weight;
        });

        const avgBeta = totalWeight > 0 ? totalWeightedBeta / totalWeight : 0;
        setCurrentEffect(avgBeta);
      }
    }
  }, [processedData, filters, citationWindow, quantileValue]);

  // Sync selectedNode with networkData updates
  useEffect(() => {
    if (selectedNode && networkData.nodes.length > 0) {
      const updated = networkData.nodes.find(n => n.id === selectedNode.id);
      if (updated && updated !== selectedNode) {
        setSelectedNode(updated);
      }
    }
  }, [networkData, selectedNode]);



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
        onOpenHelp={() => setShowHelp(true)}
        onOpenAnalysis={() => setFilters({ ...filters, showAnalysis: true })}
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
          {selectedNode.avgRS_theoretical > 0 && (
            <div className="detail-row">
              <span>RS Thematic:</span>
              <span>{selectedNode.avgRS_theoretical.toFixed(4)}</span>
            </div>
          )}
          {selectedNode.avgRS_methodological > 0 && (
            <div className="detail-row">
              <span>RS Methodological:</span>
              <span>{selectedNode.avgRS_methodological.toFixed(4)}</span>
            </div>
          )}
          {selectedNode.avgRS_cross > 0 && (
            <div className="detail-row">
              <span>RS Cross:</span>
              <span>{selectedNode.avgRS_cross.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {filters.showAnalysis && (
        <TopClustersModal
          combinations={networkData.combinations}
          onClose={() => setFilters({ ...filters, showAnalysis: false })}
        />
      )}
    </div>
  );
};

export default App;
