import { read_from_file } from "../utils/fs";

export async function visualize_graph() {
    const annotated_file = './annotated_mods.json';
    const file_contents = await read_from_file(annotated_file);
    const mod_map: Map<string, any> = new Map(Object.entries(file_contents));

    // Build Cytoscape elements
    const nodes = mod_map
        .entries()
        .map(([id, val]) => ({
            data: { id, label: id, degree: val.wanted_by ? val.wanted_by.length : 0 },
        }))
        .toArray();

    const edges: Array<{ data: { source: string; target: string; label: string } }> = [];
    for (const [mod_id, mod] of mod_map) {
        if (mod.wants) {
            for (const dep of mod.wants) {
                if (mod_map.has(dep)) {
                    edges.push({ data: { source: mod_id, target: dep, label: 'wants' } });
                }
            }
        }
        // Derived connections go two-way, so we just use one
        // if (mod.wanted_by) {
        //     for (const dep of mod.wanted_by) {
        //         if (mod_map.has(dep)) {
        //             edges.push({ data: { source: dep, target: mod_id, label: "wanted_by" } });
        //         }
        //     }
        // }
    }

    // Remove duplicate edges (optional)
    const edgeSet = new Set();
    const uniqueEdges = edges.filter((e) => {
        const key = `${e.data.source}->${e.data.target}`;
        if (edgeSet.has(key)) return false;
        edgeSet.add(key);
        return true;
    });

    // HTML template for Cytoscape
    const html = `
<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <title>Mod Dependency Graph</title>
    <style>
        body {
            background-color: #152333;
        }

        #cy {
            width: 100vw;
            height: 100vh;
            display: block;
        }
    </style>
    <script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
</head>

<body>
    <div id="cy"></div>
    <script>
        const cy = cytoscape({
            container: document.getElementById('cy'),
            elements: ${JSON.stringify([...nodes, ...uniqueEdges])},
            style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'background-color': '#0074D9',
                    'color': '#fff',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': 11,
                    'width': 'mapData(degree, 1, 10, 30, 80)',
                    'height': 'mapData(degree, 1, 10, 30, 80)'
                }
            },
            {
                selector: 'edge[label="wants"]',
                style: {
                    'width': 2,
                    'color': '#bbb',
                    'line-color': '#00c853',
                    'target-arrow-color': '#00c853',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 6,
                    'text-rotation': 'autorotate',
                    'text-margin-y': -8
                }
            },
            {
                selector: 'edge[label="wanted_by"]',
                style: {
                    'width': 2,
                    'color': '#bbb',
                    'line-color': '#ff9800',
                    'target-arrow-color': '#ff9800',
                    'target-arrow-shape': 'tee',
                    'curve-style': 'bezier',
                    'label': 'data(label)',
                    'font-size': 6,
                    'text-rotation': 'autorotate',
                    'text-margin-y': -8
                }
            }
        ],
            layout: {
            name: 'cose',
            animate: true
        },
            wheelSensitivity: 0.6
            });
    </script>
</body>

</html>
    `;

    Bun.file('graph.html').write(html);
}