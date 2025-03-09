/**
 * TreeUtils - Utility functions for working with the phylogenetic tree data
 */

/**
 * Find which tree a genome belongs to in the phylogenetic tree data
 * @param {Object} treeData - The complete tree data structure
 * @param {string} genomeId - The genome ID to search for
 * @returns {Object|null} - Information about the tree containing the genome, or null if not found
 */
export const findTreeForGenome = (treeData, genomeId) => {
  if (!treeData || !genomeId) return null;

  // Debug the incoming parameters
  console.log('findTreeForGenome called with:', { 
    genomeId,
    treeDataType: typeof treeData,
    hasTreesArray: Array.isArray(treeData.trees),
    hasNodesArray: Array.isArray(treeData.nodes),
    hasRootNodes: Boolean(treeData.rootNodes),
    // Add checks for PhylogeneticViewer format
    hasGenomes: Boolean(treeData.genomes),
    isNestFormat: Boolean(treeData.name && treeData.children),
    topLevelKeys: Object.keys(treeData)
  });

  // First try extract genome ID from long format if applicable
  const shortGenomeId = extractGenomeId(genomeId);
  
  // First check if treeData is already a Nest format tree (used by PhylogeneticViewer)
  if (treeData.name && (Array.isArray(treeData.children) || treeData.value)) {
    // PhylogeneticViewer uses D3's nest format with a name property
    return searchNestStructure(treeData, genomeId, shortGenomeId);
  }
  
  // Next check for a flat list of genomes (PhylogeneticViewer might use this)
  if (treeData.genomes && Array.isArray(treeData.genomes)) {
    // Check if genome exists in the list
    const genomeIndex = treeData.genomes.findIndex(
      g => g.id === genomeId || g.id === shortGenomeId || 
           g.id?.includes(shortGenomeId) || g.name === genomeId || 
           g.name?.includes(shortGenomeId)
    );
    
    if (genomeIndex >= 0) {
      return {
        treeIndex: 0, // Single tree in this format
        treeId: 'main_tree',
        rootId: treeData.rootId || null,
        genomeIndex
      };
    }
  }
  
  // Rest of existing structure checks (trees array, nodes/edges, etc.)
  if (Array.isArray(treeData.trees)) {
    // Iterate through each tree
    for (let i = 0; i < treeData.trees.length; i++) {
      const tree = treeData.trees[i];
      
      // Check if this genome is in this tree
      if (isGenomeInTree(tree, genomeId) || isGenomeInTree(tree, shortGenomeId)) {
        return {
          treeIndex: i,
          treeId: tree.id || `tree_${i}`,
          rootId: tree.root?.id || null
        };
      }
    }
  } 
  // Check if we have rootNodes structure (common in graph formats)
  else if (treeData.rootNodes) {
    // Each rootNode is the root of a separate tree
    const rootNodes = Array.isArray(treeData.rootNodes) ? treeData.rootNodes : [treeData.rootNodes];
    
    for (let i = 0; i < rootNodes.length; i++) {
      const rootNode = rootNodes[i];
      
      // Create a tree-like structure for this rootNode
      const treeForRoot = {
        nodes: treeData.nodes,
        edges: treeData.edges,
        root: rootNode
      };
      
      // Check if this genome is in this tree
      if (isGenomeInTreeRecursive(treeForRoot, genomeId, treeData.nodes, treeData.edges) || 
          isGenomeInTreeRecursive(treeForRoot, shortGenomeId, treeData.nodes, treeData.edges)) {
        return {
          treeIndex: i,
          treeId: rootNode.id || `tree_${i}`,
          rootId: rootNode.id
        };
      }
    }
  }
  // Alternative structure: check if treeData has nodes and edges directly
  else if (treeData.nodes || treeData.edges) {
    if (isGenomeInTree(treeData, genomeId) || isGenomeInTree(treeData, shortGenomeId)) {
      return {
        treeIndex: 0,
        treeId: treeData.id || 'main_tree',
        rootId: treeData.root?.id || null
      };
    }
  }
  // Try a completely different approach: search for any property that might contain our genome
  else {
    // For PhylogeneticViewer, try common nested structures
    for (const key in treeData) {
      if (typeof treeData[key] === 'object' && treeData[key] !== null) {
        // Check if this object has a format that might be a tree or contain our genome
        const result = searchForGenomeInObject(treeData[key], genomeId, shortGenomeId);
        if (result) {
          return {
            treeIndex: 0,
            treeId: key,
            rootId: null,
            foundAt: result.path
          };
        }
      }
    }
  }
  
  console.log(`No tree found for genome ${genomeId}`, {
    treeDataStructure: {
      hasTreesArray: Array.isArray(treeData.trees),
      hasNodesArray: Array.isArray(treeData.nodes),
      nodeCount: treeData.nodes?.length,
      edgeCount: treeData.edges?.length,
      rootNodeCount: treeData.rootNodes?.length,
      // Add these new checks
      hasGenomes: Boolean(treeData.genomes),
      genomeCount: treeData.genomes?.length,
      isNestFormat: Boolean(treeData.name && treeData.children),
      topLevelKeys: Object.keys(treeData)
    }
  });
  
  return null;
};

/**
 * Search for a genome in a D3 nest structure (nested objects with name and children properties)
 * Used by PhylogeneticViewer. Updated to identify multiple trees.
 */
const searchNestStructure = (node, genomeId, shortGenomeId, path = '') => {
  // First identify the top-level trees
  const trees = [];
  
  // For a D3 hierarchy structure, each top-level child is considered a separate tree
  if (node.name === 'root' && Array.isArray(node.children)) {
    // Pre-analyze the tree structure to understand how to divide it into separate trees
    console.log('Analyzing D3 tree structure:', {
      rootName: node.name,
      childrenCount: node.children.length,
      firstChildName: node.children[0]?.name,
      secondChildName: node.children[1]?.name,
      childrenTypes: node.children.map(child => ({
        name: child.name,
        hasChildren: Boolean(child.children),
        childrenCount: child.children?.length
      }))
    });

    // Find the tree divisions
    let treeDivisionLevel = 0;
    
    // First try the top level - is each direct child a tree?
    if (node.children.length > 1 && node.children.every(child => child.name)) {
      treeDivisionLevel = 1;
      trees.push(...node.children.map((child, index) => ({
        treeNode: child,
        name: child.name || `tree_${index}`,
        index
      })));
    } 
    // If not, maybe second level is the tree level
    else if (node.children.length > 0 && 
            node.children[0].children && 
            node.children[0].children.length > 1) {
      treeDivisionLevel = 2;
      node.children[0].children.forEach((grandChild, index) => {
        if (grandChild && (grandChild.name || grandChild.children)) {
          trees.push({
            treeNode: grandChild,
            name: grandChild.name || `tree_${index}`,
            index
          });
        }
      });
    }
    // If not at first or second level, try the most likely structure
    else if (node.children.length >= 2) {
      // Just use the first two main branches as trees
      treeDivisionLevel = 1;
      trees.push(
        { treeNode: node.children[0], name: 'tree_0', index: 0 },
        { treeNode: node.children[1], name: 'tree_1', index: 1 }
      );
    }
    // If we can't identify tree divisions, just go with one tree
    else {
      trees.push({
        treeNode: node,
        name: 'single_tree',
        index: 0
      });
    }

    console.log('Identified tree structure:', {
      treeDivisionLevel,
      treeCount: trees.length,
      trees: trees.map(t => ({ name: t.name, index: t.index }))
    });

    // Store the identified trees count in global cache for statistics use
    window._treeUtilsCache = window._treeUtilsCache || {};
    window._treeUtilsCache.identifiedTreesCount = trees.length;
    window._treeUtilsCache.treeNames = trees.map(t => t.name);

    // Now search each tree for our genome
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      const result = searchInTreeNode(tree.treeNode, genomeId, shortGenomeId, `/${tree.index}`);
      
      if (result) {
        return {
          treeIndex: tree.index,
          treeId: tree.name,
          rootId: tree.treeNode.id || null,
          path: result.path
        };
      }
    }
    
    return null;
  }
  
  // If not a standard root node with children, try the regular node match
  return searchInTreeNode(node, genomeId, shortGenomeId, path);
};

/**
 * Search within a node of a tree hierarchy
 */
const searchInTreeNode = (node, genomeId, shortGenomeId, path = '') => {
  // Check if current node matches
  if (node.name === genomeId || node.id === genomeId || 
      node.name === shortGenomeId || node.id === shortGenomeId ||
      node.name?.includes(shortGenomeId) || node.id?.includes(shortGenomeId)) {
    return {
      found: true,
      path: path || '/'
    };
  }
  
  // Recursively search children if they exist
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const childPath = path ? `${path}/${i}` : `/${i}`;
      const result = searchInTreeNode(node.children[i], genomeId, shortGenomeId, childPath);
      if (result) return result;
    }
  }
  
  // Check values/leaves array if present (another D3 format)
  if (Array.isArray(node.values) || Array.isArray(node._values)) {
    const values = node.values || node._values;
    for (let i = 0; i < values.length; i++) {
      const itemPath = path ? `${path}/values/${i}` : `/values/${i}`;
      // Check if this value has the genome ID we're looking for
      const value = values[i];
      
      if (
        value.name === genomeId || value.id === genomeId || 
        value.name === shortGenomeId || value.id === shortGenomeId ||
        value.name?.includes(shortGenomeId) || value.id?.includes(shortGenomeId) ||
        value.genomeId === genomeId || value.genomeId === shortGenomeId ||
        value.genomeId?.includes(shortGenomeId)
      ) {
        return {
          found: true,
          path: itemPath
        };
      }
      
      // If value is an object, try recursively
      if (typeof value === 'object' && value !== null) {
        const result = searchInTreeNode(value, genomeId, shortGenomeId, itemPath);
        if (result) return result;
      }
    }
  }
  
  return null;
};

/**
 * Extract a short genome ID from a potentially longer format
 */
const extractGenomeId = (genomeId) => {
  // Standard format from logs: "01JDY45XNSTPHQXCJ9Z543AQH2"
  // We need to extract: "Z543AQH2" from it
  
  // Pattern 1: Looking for typical suffixes after 01JD prefix
  if (genomeId.includes('01JD')) {
    const parts = genomeId.split('01JD');
    return parts[parts.length - 1];
  }
  
  // Pattern 2: Looking for parts after the last alphanumeric section
  const match = genomeId.match(/([A-Z0-9]+)$/);
  if (match) {
    return match[0];
  }
  
  return genomeId;
};

/**
 * Check if a genome exists in a specific tree
 * @param {Object} tree - Tree object containing nodes and edges
 * @param {string} genomeId - The genome ID to search for
 * @returns {boolean} - True if the genome is found in the tree
 */
const isGenomeInTree = (tree, genomeId) => {
  // Check for genomes list directly
  if (Array.isArray(tree.genomes)) {
    if (tree.genomes.some(genome => 
      genome.id === genomeId || 
      (genome.id && genome.id.includes(genomeId)) ||
      genome.name === genomeId ||
      (genome.name && genome.name.includes(genomeId))
    )) {
      return true;
    }
  }
  
  // Check in nodes
  if (Array.isArray(tree.nodes)) {
    if (tree.nodes.some(node => 
      node.id === genomeId || 
      (node.name && node.name === genomeId) ||
      (node.id && node.id.includes(genomeId)) ||
      (node.genome && node.genome === genomeId) ||
      (node.genomeId && node.genomeId === genomeId)
    )) {
      return true;
    }
  } 
  // Some trees might have an 'items' array
  else if (Array.isArray(tree.items)) {
    if (tree.items.some(item => 
      item.id === genomeId || 
      (item.name && item.name === genomeId) ||
      (item.id && item.id.includes(genomeId)) ||
      (item.genome && item.genome === genomeId) ||
      (item.genomeId && item.genomeId === genomeId)
    )) {
      return true;
    }
  }
  
  // Check in edges (a genome might be referenced in an edge but not as a node)
  if (Array.isArray(tree.edges)) {
    if (tree.edges.some(edge => (
      edge.source === genomeId || 
      edge.target === genomeId ||
      (edge.source && edge.source.includes(genomeId)) ||
      (edge.target && edge.target.includes(genomeId))
    ))) {
      return true;
    }
  }
  
  // Check in nested children (D3 format)
  if (Array.isArray(tree.children)) {
    for (const child of tree.children) {
      if (isGenomeInTree(child, genomeId)) {
        return true;
      }
    }
  }
  
  return false;
};

/**
 * Recursive check for genome in tree starting from a root node
 * For tree structures where nodes are connected via edges
 */
const isGenomeInTreeRecursive = (tree, genomeId, nodes, edges, visited = new Set()) => {
  if (!tree || !tree.root || !nodes || !edges) return false;
  
  const rootId = tree.root.id;
  
  // Check if the root itself is the genome we're looking for
  if (rootId === genomeId || rootId.includes(genomeId)) {
    return true;
  }
  
  // Mark this node as visited to prevent cycles
  visited.add(rootId);
  
  // Get all edges where this node is the source
  const childEdges = edges.filter(edge => edge.source === rootId);
  
  // Recursively check all children
  for (const edge of childEdges) {
    // Skip if we've already visited this target
    if (visited.has(edge.target)) continue;
    
    // Check if the target is our genome
    if (edge.target === genomeId || edge.target.includes(genomeId)) {
      return true;
    }
    
    // Find the target node
    const targetNode = nodes.find(node => node.id === edge.target);
    if (targetNode) {
      // Recursively check this subtree
      const found = isGenomeInTreeRecursive(
        { root: targetNode },
        genomeId,
        nodes,
        edges,
        visited
      );
      
      if (found) return true;
    }
  }
  
  return false;
};

/**
 * Get statistics about which trees the voices in a sequence belong to
 * @param {Array} sequenceItems - Array of sequence items containing genomeIds
 * @param {Object} treeData - The complete tree data structure
 * @returns {Object} - Statistics about trees and voice distribution
 */
export const getSequenceTreeStatistics = (sequenceItems, treeData) => {
  if (!sequenceItems || !treeData) {
    return { treeCount: 0, itemsByTree: {}, treesRepresented: 0 };
  }
  
  const itemsByTree = {};
  const treeIndices = new Set();
  
  // Count number of trees in tree data - handle different structures
  let treeCount = 0;
  
  // For D3 hierarchy (PhylogeneticViewer format)
  if (treeData.name && Array.isArray(treeData.children)) {
    if (treeData.name === 'root') {
      // Use the cached tree count from findTreeForGenome if available
      if (window._treeUtilsCache && window._treeUtilsCache.identifiedTreesCount) {
        treeCount = window._treeUtilsCache.identifiedTreesCount;
        console.log('Using cached tree count:', treeCount, 
          window._treeUtilsCache.treeNames ? 
            `(Trees: ${window._treeUtilsCache.treeNames.join(', ')})` : 
            '');
      } 
      // Otherwise, count direct children that have names as separate trees
      else {
        // Count children with names as trees
        const namedChildren = treeData.children.filter(child => child.name);
        if (namedChildren.length > 0) {
          treeCount = namedChildren.length;
          console.log('Using named children count as tree count:', treeCount);
        } else {
          treeCount = Math.max(1, treeData.children.length);
          console.log('Using children count as tree count:', treeCount);
        }
      }
    } else {
      treeCount = 1; // Single D3 tree
    }
  }
  // Check other formats
  else if (Array.isArray(treeData.trees)) {
    treeCount = treeData.trees.length;
  } else if (Array.isArray(treeData.rootNodes)) {
    treeCount = treeData.rootNodes.length;
  } else if (treeData.rootNodes) {
    treeCount = 1; // Single root node
  } else {
    treeCount = 1; // Assume single tree if no specific structure
  }
  
  console.log('Tree count determination:', {
    isD3Format: !!(treeData.name && Array.isArray(treeData.children)),
    isRootNode: treeData.name === 'root',
    childCount: treeData.children?.length,
    cachedTreeCount: window._treeUtilsCache?.identifiedTreesCount,
    determinedTreeCount: treeCount
  });
  
  // Process each sequence item to find which tree they belong to
  sequenceItems.forEach(item => {
    if (!item.genomeId) return;
    
    const treeInfo = findTreeForGenome(treeData, item.genomeId);
    if (treeInfo) {
      const treeKey = `tree_${treeInfo.treeIndex}`;
      if (!itemsByTree[treeKey]) {
        itemsByTree[treeKey] = [];
        treeIndices.add(treeInfo.treeIndex);
      }
      
      itemsByTree[treeKey].push({
        genomeId: item.genomeId,
        treeIndex: treeInfo.treeIndex,
        treeId: treeInfo.treeId,
        path: treeInfo.path
      });
    } else {
      // For items not found in any tree
      if (!itemsByTree['unknown']) {
        itemsByTree['unknown'] = [];
      }
      itemsByTree['unknown'].push({ genomeId: item.genomeId });
    }
  });
  
  // If treeCount is less than the number of tree indices we found,
  // adjust treeCount to match reality
  if (treeIndices.size > treeCount) {
    console.log(`Adjusting tree count from ${treeCount} to ${treeIndices.size} based on found trees`);
    treeCount = treeIndices.size;
  }
  
  // IMPORTANT: Make sure to use the cached tree count here
  const finalTreeCount = window._treeUtilsCache?.identifiedTreesCount || treeCount;
  
  console.log('Final tree statistics:', {
    treeCount: finalTreeCount,
    treesRepresented: treeIndices.size,
    treeIndicesFound: Array.from(treeIndices).sort(),
    itemsByTree: Object.keys(itemsByTree)
  });
  
  return {
    treeCount: finalTreeCount, // Use the cached count or our determined count
    itemsByTree,
    treesRepresented: treeIndices.size,
    treeIndices: Array.from(treeIndices)
  };
};

/**
 * Debug function to log tree data structure
 * @param {Object} treeData - The tree data to analyze
 */
export const logTreeStructure = (treeData) => {
  console.log('Tree Data Structure Analysis:', {
    hasTreesArray: Array.isArray(treeData.trees),
    treesLength: treeData.trees?.length,
    hasNodesArray: Array.isArray(treeData.nodes),
    nodesLength: treeData.nodes?.length,
    hasEdgesArray: Array.isArray(treeData.edges),
    edgesLength: treeData.edges?.length,
    hasRootNodes: Boolean(treeData.rootNodes),
    rootNodesCount: Array.isArray(treeData.rootNodes) ? treeData.rootNodes.length : (treeData.rootNodes ? 1 : 0),
    sampleNodeIds: treeData.nodes?.slice(0, 3).map(n => n.id),
    // Add PhylogeneticViewer specific information
    hasGenomes: Boolean(treeData.genomes),
    genomesLength: treeData.genomes?.length,
    sampleGenomeIds: treeData.genomes?.slice(0, 3).map(g => g.id || g.name),
    isNestFormat: Boolean(treeData.name && treeData.children),
    childrenLength: treeData.children?.length,
    nestName: treeData.name,
    d3Structure: getD3StructureAnalysis(treeData),
    // Add a more comprehensive structure analysis
    topLevelKeys: Object.keys(treeData),
    simpleStruct: getSimpleStructRepresentation(treeData)
  });
};

/**
 * Get a more detailed analysis of D3 hierarchy structure
 */
function getD3StructureAnalysis(treeData) {
  if (!treeData || !treeData.name || !Array.isArray(treeData.children)) {
    return 'Not a D3 hierarchy';
  }

  // Analyze the first few levels
  const levels = [];
  
  // Level 0 (root)
  levels.push({
    name: treeData.name,
    childCount: treeData.children.length,
    hasIds: !!treeData.id,
    allChildrenHaveNames: treeData.children.every(child => !!child.name)
  });
  
  // Level 1
  if (treeData.children && treeData.children.length > 0) {
    const level1 = {
      childCount: treeData.children.length,
      sampleNames: treeData.children.slice(0, 3).map(c => c.name || 'unnamed'),
      allHaveChildren: treeData.children.every(c => Array.isArray(c.children) && c.children.length > 0),
      namedChildCount: treeData.children.filter(c => c.name).length
    };
    levels.push(level1);
    
    // Sample some internal paths
    const childPaths = [];
    const uniqueNames = new Set();
    
    // Check first few children for unique names and structure
    for (let i = 0; i < Math.min(treeData.children.length, 5); i++) {
      const child = treeData.children[i];
      if (child.name) uniqueNames.add(child.name);
      
      // Sample a path within this child
      let currentNode = child;
      let path = [child.name || `node_${i}`];
      
      // Go up to 5 levels deep as a sample
      for (let j = 0; j < 5; j++) {
        if (!currentNode.children || !currentNode.children.length) break;
        const nextNode = currentNode.children[0];
        path.push(nextNode.name || `level_${j}`);
        currentNode = nextNode;
      }
      
      childPaths.push(path.join(' → '));
    }
    
    // Sample path information
    return {
      levels,
      possibleTreesAt: determinePossibleTreeLevel(levels),
      uniqueNamedNodes: uniqueNames.size,
      samplePaths: childPaths
    };
  }
  
  return {
    levels,
    possibleTreesAt: determinePossibleTreeLevel(levels)
  };
}

/**
 * Determine which level is most likely to contain separate trees
 */
function determinePossibleTreeLevel(levels) {
  if (levels.length < 2) return 0;
  
  // First check if all direct children have names - best indicator for tree divisions
  if (levels[0].allChildrenHaveNames) {
    return 1;
  }
  
  // If level 1 has multiple children and all have children, it's likely level 1
  if (levels[1].childCount > 1 && levels[1].allHaveChildren) {
    return 1;
  }
  
  // If there are several named children at level 1, it's likely level 1
  if (levels[1].namedChildCount >= 2) {
    return 1;
  }
  
  // If level 2 exists and has many children, it might be level 2
  if (levels.length >= 3 && levels[2].childCount > 1) {
    return 2;
  }
  
  // Default to level 1
  return 1;
}

/**
 * Get a simple representation of object structure for debugging
 */
function getSimpleStructRepresentation(obj, maxDepth = 2, depth = 0) {
  if (depth >= maxDepth) return '[max depth reached]';
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    if (depth === maxDepth - 1) return `[Array(${obj.length})]`;
    return `[${obj.slice(0, 2).map(item => getSimpleStructRepresentation(item, maxDepth, depth + 1)).join(', ')}${obj.length > 2 ? ', ...' : ''}]`;
  }
  
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    if (depth === maxDepth - 1) return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
    
    const entries = keys.slice(0, 3).map(key => {
      return `${key}: ${getSimpleStructRepresentation(obj[key], maxDepth, depth + 1)}`;
    });
    
    return `{${entries.join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
  }
  
  return typeof obj;
}
