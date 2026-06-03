(function () {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('embedded') === '1') return;
  const body = document.body;
  const shell = document.querySelector('.app-shell');
  const appMain = shell?.querySelector('.app-main');
  const sidebar = shell?.querySelector('.sidebar');
  if (!body || !shell || !appMain || !sidebar) return;

  const page = String(body.dataset.shellPage || '');
  const isFlowPage = page === 'workflow' || page === 'dataflow';
  if (!isFlowPage) return;
  if (appMain.querySelector('.workspace-layout')) return;

  const main = appMain.querySelector('main');
  if (!main) return;
  const rightSidebar = document.getElementById('rightSidebar');

  shell.classList.remove('app-shell--with-right-sidebar');
  body.classList.add('workspace-enabled');

  const workspaceLayout = document.createElement('div');
  workspaceLayout.className = 'workspace-layout';

  const globalLeftArea = document.createElement('aside');
  globalLeftArea.className = 'workspace-global-left-area';
  globalLeftArea.id = 'workspaceGlobalLeftArea';
  globalLeftArea.innerHTML = [
    '<div class="workspace-global-left-area__head" id="workspaceLeftAreaTitle">サイドエリア</div>',
    '<div class="workspace-global-left-area__body" id="workspaceLeftAreaBody">',
    '<div class="workspace-empty">左サイドバーから機能を選択してください。</div>',
    '</div>'
  ].join('');

  const workspaceRegion = document.createElement('section');
  workspaceRegion.className = 'workspace-region';

  const tabHeader = document.createElement('div');
  tabHeader.className = 'workspace-tab-header';
  tabHeader.id = 'workspaceTabHeader';
  tabHeader.innerHTML = '<div class="workspace-tabs" id="workspaceTabs"></div>';

  const panes = document.createElement('div');
  panes.className = 'workspace-panes';
  panes.id = 'workspacePanes';
  panes.innerHTML = [
    '<section class="workspace-pane is-active" data-pane="left">',
    '  <div class="workspace-pane-head" data-pane-head="left">',
    '    <input type="text" class="workspace-pane-title-input" data-pane-title="left" aria-label="左ペイン ファイル名" />',
    '    <span class="workspace-pane-dirty" data-pane-dirty="left" aria-hidden="true">●</span>',
    '    <div class="workspace-pane-actions">',
    '    </div>',
    '  </div>',
    '  <div class="workspace-pane-body" data-pane-body="left"></div>',
    '</section>',
    '<div class="workspace-splitter" id="workspaceSplitter" role="separator" aria-orientation="vertical" aria-label="左右ペイン幅"></div>',
    '<section class="workspace-pane" data-pane="right">',
    '  <div class="workspace-pane-head" data-pane-head="right">',
    '    <input type="text" class="workspace-pane-title-input" data-pane-title="right" aria-label="右ペイン ファイル名" />',
    '    <span class="workspace-pane-dirty" data-pane-dirty="right" aria-hidden="true">●</span>',
    '    <div class="workspace-pane-actions">',
    '    </div>',
    '  </div>',
    '  <div class="workspace-pane-body" data-pane-body="right"></div>',
    '</section>'
  ].join('');

  workspaceRegion.appendChild(tabHeader);
  workspaceRegion.appendChild(panes);
  workspaceLayout.appendChild(globalLeftArea);
  workspaceLayout.appendChild(workspaceRegion);

  const hiddenHost = document.createElement('div');
  hiddenHost.className = 'workspace-flow-hidden-host';
  hiddenHost.hidden = true;
  const dataflowView = document.createElement('div');
  dataflowView.className = 'workspace-dataflow-view';
  dataflowView.dataset.viewType = 'dataflow';
  dataflowView.dataset.tabId = 'tab-dataflow';
  dataflowView.appendChild(main);
  if (rightSidebar) dataflowView.appendChild(rightSidebar);
  hiddenHost.appendChild(dataflowView);

  appMain.innerHTML = '';
  appMain.appendChild(workspaceLayout);
  appMain.appendChild(hiddenHost);

  window.zizWorkspaceShell = {
    appShell: shell,
    appMain,
    workspaceLayout,
    globalLeftArea,
    leftAreaTitle: globalLeftArea.querySelector('#workspaceLeftAreaTitle'),
    leftAreaBody: globalLeftArea.querySelector('#workspaceLeftAreaBody'),
    workspaceRegion,
    tabHeader,
    tabsHost: tabHeader.querySelector('#workspaceTabs'),
    panes,
    splitter: panes.querySelector('#workspaceSplitter'),
    leftPane: panes.querySelector('[data-pane="left"]'),
    rightPane: panes.querySelector('[data-pane="right"]'),
    leftPaneHead: panes.querySelector('[data-pane-head="left"]'),
    rightPaneHead: panes.querySelector('[data-pane-head="right"]'),
    leftPaneTitleInput: panes.querySelector('[data-pane-title="left"]'),
    rightPaneTitleInput: panes.querySelector('[data-pane-title="right"]'),
    leftPaneDirtyMark: panes.querySelector('[data-pane-dirty="left"]'),
    rightPaneDirtyMark: panes.querySelector('[data-pane-dirty="right"]'),
    leftPaneBody: panes.querySelector('[data-pane-body="left"]'),
    rightPaneBody: panes.querySelector('[data-pane-body="right"]'),
    dataflowView,
  };
})();



