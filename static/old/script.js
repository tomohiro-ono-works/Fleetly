// ノードの基本設定
const NODE_W = 140, NODE_H = 51, LEVEL_MARGIN = 170, MIN_SIBLING_GAP = 12;
let nodes = [], root = null;

class Node {
    constructor(text, parentId = null) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.text = text; this.note = "";
        this.label1 = null; this.label2 = null; this.label3 = null;
        this.parentId = parentId; this.children = [];
        this.x = 0; this.y = 0; this.subtreeHeight = NODE_H;
    }
}

// 初期データの作成
root = new Node("中心トピック");
nodes.push(root);

// ツリー構造の計算ロジック
function updateSubtreeHeights(node) {
    if (node.children.length === 0) return node.subtreeHeight = NODE_H;
    let childrenHeight = node.children.reduce((acc, c) => acc + updateSubtreeHeights(c), 0);
    childrenHeight += (node.children.length - 1) * MIN_SIBLING_GAP;
    return node.subtreeHeight = Math.max(NODE_H, childrenHeight);
}

function layoutNodes(node) {
    if (node.children.length === 0) return;
    let currentY = node.y;
    node.children.forEach(c => {
        c.x = node.x + LEVEL_MARGIN;
        c.y = currentY;
        layoutNodes(c);
        currentY += c.subtreeHeight + MIN_SIBLING_GAP;
    });
}

function fullLayout() {
    if (!root) return;
    root.x = 50; root.y = 50;
    updateSubtreeHeights(root); 
    layoutNodes(root); 
    
    // 一番下のノードの位置を特定
    const maxY = Math.max(...nodes.map(n => n.y)) + NODE_H + 100;
    
    const dpr = window.devicePixelRatio || 1;
    // 横幅はウィンドウサイズ固定、縦幅はコンテンツに合わせる
    canvas.width = window.innerWidth * dpr;
    canvas.height = Math.max(window.innerHeight - canvas.offsetTop, maxY) * dpr;
    
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = Math.max(window.innerHeight - canvas.offsetTop, maxY) + 'px';
    
    ctx.scale(dpr*2, dpr*2);

    if (typeof draw === 'function') draw();
}

// JSON入出力
function exportJson() {
    const wrap = (n) => ({
        id: n.id, name: n.text, memo: n.note, 
        label1: n.label1, label2: n.label2, label3: n.label3,
        childrens: n.children.map(wrap)
    });
    const data = {
        title: document.getElementById('map-title').value,
        settings: { l1: document.getElementById('l-opt-1').value, l2: document.getElementById('l-opt-2').value, l3: document.getElementById('l-opt-3').value },
        tree: wrap(root)
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = data.title + '.json'; a.click();
}

function importJson(e) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const data = JSON.parse(ev.target.result);
        document.getElementById('map-title').value = data.title || "";
        document.getElementById('l-opt-1').value = data.settings?.l1 || "";
        document.getElementById('l-opt-2').value = data.settings?.l2 || "";
        document.getElementById('l-opt-3').value = data.settings?.l3 || "";
        nodes = [];
        const unwrap = (item, pId = null) => {
            const n = new Node(item.name, pId); n.id = item.id; n.note = item.memo;
            n.label1 = item.label1; n.label2 = item.label2; n.label3 = item.label3;
            nodes.push(n);
            if (item.childrens) item.childrens.forEach(c => n.children.push(unwrap(c, n.id)));
            return n;
        };
        root = unwrap(data.tree); 
        fullLayout();
    };
    reader.readAsText(e.target.files[0]);
}