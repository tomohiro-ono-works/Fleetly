const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const menu = document.getElementById('context-menu');
let hoverNode = null, selectedNode = null, rightClickedNode = null;

function init() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight - canvas.offsetTop;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.scale(dpr*2, dpr*2);
}
window.addEventListener('resize', () => { init(); fullLayout(); });

function wrapText(text, maxWidth) {
    const chars = text.split("");
    let line = "";
    let lines = [];
    for (let n = 0; n < chars.length; n++) {
        let testLine = line + chars[n];
        let metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            lines.push(line);
            line = chars[n];
        } else {
            line = testLine;
        }
    }
    lines.push(line);
    if (lines.length > 2) {
        lines = [lines[0], lines[1].substring(0, lines[1].length - 1) + "..."];
    }
    return lines;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // CSS変数から実際の色を取得
    const style = getComputedStyle(document.documentElement);
    const labelColors = {
        1: style.getPropertyValue('--label1-clr').trim(),
        2: style.getPropertyValue('--label2-clr').trim(),
        3: style.getPropertyValue('--label3-clr').trim()
    };

    nodes.forEach(n => {
        if (n.parentId) {
            const p = nodes.find(node => node.id === n.parentId);
            ctx.beginPath(); ctx.moveTo(p.x + NODE_W, p.y + NODE_H/2);
            ctx.bezierCurveTo(p.x + NODE_W + 40, p.y + NODE_H/2, n.x - 40, n.y + NODE_H/2, n.x, n.y + NODE_H/2);
            ctx.strokeStyle = '#cbd5e0'; ctx.lineWidth = 1.5; ctx.stroke();
        }

        ctx.fillStyle = (n === selectedNode) ? '#ebf8ff' : (n === root ? '#3182ce' : '#fff');
        ctx.strokeStyle = (n === selectedNode) ? '#3182ce' : (n === root ? '#3182ce' : '#cbd5e0');
        ctx.lineWidth = (n === selectedNode) ? 2.5 : 1.2;
        ctx.beginPath(); ctx.roundRect(n.x, n.y, NODE_W, NODE_H, 8); ctx.fill(); ctx.stroke();

        // --- ラベル描画の修正 ---
        const drawL = (txt, x, y, clr) => {
            if(!txt || txt === "null") return;
            ctx.fillStyle = clr; 
            ctx.beginPath(); 
            ctx.arc(x, y, 11, 0, Math.PI*2); // 2文字入るよう少し大きく
            ctx.fill();
            ctx.fillStyle = '#fff'; 
            ctx.font = 'bold 10px sans-serif'; 
            ctx.textAlign = 'center';
            ctx.fillText(txt.substring(0, 2), x, y + 3.5);
        };
        
        // 座標をノードの縁に固定（NODE_H=51に対応）
        drawL(n.label1, n.x + NODE_W, n.y, labelColors[1]);           // 右上
        drawL(n.label2, n.x + NODE_W, n.y + NODE_H, labelColors[2]);   // 右下
        drawL(n.label3, n.x, n.y + NODE_H, labelColors[3]);            // 左下

        ctx.fillStyle = n === root ? '#fff' : '#2d3748';
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        const lines = wrapText(n.text, NODE_W - 20);
        if (lines.length === 1) {
            ctx.fillText(lines[0], n.x + NODE_W/2, n.y + NODE_H/2 + 5);
        } else {
            ctx.fillText(lines[0], n.x + NODE_W/2, n.y + NODE_H/2 - 2);
            ctx.fillText(lines[1], n.x + NODE_W/2, n.y + NODE_H/2 + 14);
        }
        
        if (n.note) { ctx.font = '10px sans-serif'; ctx.fillText("📝", n.x + 14, n.y + 16); }

        if (hoverNode === n) {
            const ax = n.x + NODE_W + 12, ay = n.y + NODE_H/2;
            ctx.fillStyle = '#3182ce'; ctx.beginPath(); ctx.arc(ax, ay, 9, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax-4, ay); ctx.lineTo(ax+4, ay); ctx.moveTo(ax, ay-4); ctx.lineTo(ax, ay+4); ctx.stroke();
        }
    });
}

// --- メニュー表示関数の分離 ---
function showContextMenu(n, x, y) {
    rightClickedNode = n;
    const createMenu = (id, label, color) => {
        const opts = document.getElementById('l-opt-'+id).value.split(',').map(s => s.trim()).filter(s=>s);
        let h = `<div class="menu-category" style="color:${color}">${label}</div>`;
        h += opts.map(o => `<div class="menu-item" onclick="setLabel(${id}, '${o}')"><span class="dot" style="background:${color}"></span>${o}</div>`).join('');
        h += `<div class="menu-item" onclick="setLabel(${id}, null)">✕ 消去</div>`;
        return h;
    };
    const style = getComputedStyle(document.documentElement);
    menu.innerHTML = 
        createMenu(1, "右上", style.getPropertyValue('--label1-clr')) + 
        createMenu(2, "右下", style.getPropertyValue('--label2-clr')) + 
        createMenu(3, "左下", style.getPropertyValue('--label3-clr'));
    menu.style.display = 'block'; 
    menu.style.left = x + 'px'; 
    menu.style.top = y + 'px';
}

canvas.addEventListener('mousedown', e => {
    menu.style.display = 'none';
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // 右クリックでメニュー表示
    if (e.button === 2) {
        const n = nodes.find(n => mx >= n.x && mx <= n.x + NODE_W && my >= n.y && my <= n.y + NODE_H);
        if (n) showContextMenu(n, e.clientX, e.clientY);
        return;
    }

    // ＋ボタンクリックで子ノード追加＆ラベルメニュー表示
    if (hoverNode && Math.hypot(mx - (hoverNode.x + NODE_W + 12), my - (hoverNode.y + NODE_H/2)) < 10) {
        const n = new Node("新項目", hoverNode.id); 
        hoverNode.children.push(n); 
        nodes.push(n); 
        fullLayout();
        showContextMenu(n, e.clientX, e.clientY); // 追加したノードに対してメニューを開く
    }
});

window.setLabel = (idx, val) => { if(rightClickedNode) rightClickedNode['label'+idx] = val; draw(); menu.style.display = 'none'; };

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    hoverNode = nodes.find(n => mx >= n.x - 15 && mx <= n.x + NODE_W + 20 && my >= n.y && my <= n.y + NODE_H) || null;
    draw();
});

canvas.addEventListener('dblclick', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const n = nodes.find(n => mx >= n.x && mx <= n.x + NODE_W && my >= n.y && my <= n.y + NODE_H);
    
    if (n) {
        selectedNode = n;
        // サイドバーを表示
        document.getElementById('sidebar').classList.remove('hidden');
        
        // 1. 入力欄に新しいノードの内容をセット
        document.getElementById('edit-node-name').value = n.text;
        document.getElementById('edit-node-note').value = n.note;
        
        // 2. プレビュー表示をリセット（一旦プレビューを見せて、編集したければクリックする流れ）
        document.getElementById('edit-node-note').classList.add('hidden');
        document.getElementById('note-preview').classList.remove('hidden');
        
        // 3. ハイライトを最新の状態にする
        refreshNotePreview(); 
        
        draw();
    }
});

// ノード選択時や入力時に実行するハイライト関数
function refreshNotePreview() {
    const note = document.getElementById('edit-node-note').value;
    const preview = document.getElementById('note-preview');
    
    // コードブロック以外の部分も改行を維持して表示するため、
    // HTMLエスケープ処理を行い、コードブロックだけを置換します
    let escapedText = note
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // ```lang ... ``` の形式を検索して置換
    const html = escapedText.replace(/```(sql|python|javascript)\n([\s\S]*?)```/g, (match, lang, code) => {
        // code部分はエスケープを戻さず、そのままPrismに渡す
        return `<pre class="language-${lang}"><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // プレビューエリアにセット
    preview.innerHTML = html;

    // Prismの適用
    if (window.Prism) {
        Prism.highlightAllUnder(preview);
    }
}

// サイドバーの表示切り替え（編集時以外はハイライトを見せるなど）
document.getElementById('edit-node-note').addEventListener('blur', () => {
    document.getElementById('edit-node-note').classList.add('hidden');
    document.getElementById('note-preview').classList.remove('hidden');
    refreshNotePreview();
});

document.getElementById('note-preview').addEventListener('click', () => {
    document.getElementById('note-preview').classList.add('hidden');
    document.getElementById('edit-node-note').classList.remove('hidden');
    document.getElementById('edit-node-note').focus();
});


document.getElementById('edit-node-name').oninput = e => { if(selectedNode) { selectedNode.text = e.target.value; draw(); } };
document.getElementById('edit-node-note').oninput = e => { if(selectedNode) { selectedNode.note = e.target.value; draw(); } };
function closeSidebar() { selectedNode = null; document.getElementById('sidebar').classList.add('hidden'); draw(); }
window.addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('edit-node-note').oninput = e => {
    if (selectedNode) {
        selectedNode.note = e.target.value;
        // 入力中も裏でプレビューを準備しておく
        refreshNotePreview();
    }
};
init();
fullLayout();