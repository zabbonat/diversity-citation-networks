# Diversity Citation Networks Visualization

An interactive web-based platform for analyzing the impact of interdisciplinary combinations in economic research. This tool visualizes JEL (Journal of Economic Literature) classification codes, weighted by their **Rao-Stirling diversity indices**, to understand how combining different topics affects scientific impact.

## 🚀 Live Demo
Access the live application here: **[Diversity Citation Networks](https://zabbonat.github.io/diversity-citation-networks/)**

---

## 🔍 Overview

This application allows researchers to explore the relationship between **knowledge diversity** and **citation impact**. By visualizing the network of JEL codes, users can identify which combinations of topics (Theoretical, Methodological, or Cross-domain) tend to yield higher or lower citation returns.

### Key Concepts

*   **Nodes**: Represent individual JEL classification codes (e.g., C50, G12).
*   **Edges (Links)**: Represent the combination of two codes within the same publication.
*   **Edge Color (Effect)**: Indicates the *citation premium* (or penalty) of combining these topics.
    *   🟢 **Green (Positive)**: Combining these topics typically results in *more* citations.
    *   ⚪ **Grey (Neutral)**: No significant positive or negative effect.
    *   🔴 **Red (Negative)**: Combining these topics typically results in *fewer* citations (a penalty).

---

## ✨ Features

### 1. Interactive Quantile Explorer (τ)
Understand how effects change across the citation distribution.
*   **Slider Control**: Move the slider (`τ`) to shift focus from "all papers" to "top-cited papers".
*   **Dynamic "Current Effect"**: See real-time how the citation premium of the entire network changes as you focus on more elite publications.

### 2. Deep Filtering System
Customize the view to specific research questions.
*   **Component Types**: Toggle between **Theoretical**, **Methodological**, and **Cross-domain** connections.
*   **Separate Rao-Stirling Filters**: Set independent "Minimum RS" thresholds for each component type to filter out weak or strong links.
*   **Year Range**: Analyze trends over specific time periods (e.g., 2010-2019).

### 3. Top Combinations Analysis
Discover what works best.
*   **"Show Top Combinations"**: A dedicated modal that ranks the most successful itemsets.
*   **Multi-item Clusters**: Unlike standard graphs that show pairs, this feature identifies groups of **3, 4, or more codes** that appear together and perform well.

### 4. Rich Details
*   **JEL Descriptions**: Hover over any node to see its full definition (e.g., "C50: Econometric Modeling").
*   **Detailed Metrics**: Click a node to see its specific statistics, including total appearances and average RS scores.

---

## 🛠️ Methodology

The visualization relies on the **Rao-Stirling Diversity Index**, which measures the variety, balance, and disparity of categories. 

> Stirling, A. (2007). A general framework for analysing diversity in science, technology and society. *Journal of the Royal Society Interface*, 4(15), 707-719.

This tool applies this framework to bibliometric data, treating JEL codes as categories and their co-occurrence as a network of knowledge integration.

---

## 💻 Tech Stack

*   **Frontend**: React.js (Vite)
*   **Visualization**: D3.js (Force-directed graph)
*   **Styling**: Custom CSS (Dark/Light mode optimized)

---

## 📄 License

This project is open for academic and research use.
