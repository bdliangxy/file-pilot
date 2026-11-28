import type { en } from './en';
const pluginName = 'File Pilot'
const syncButtonName = '单向同步'
export const zh = {
	pluginTitle: pluginName,
	pluginLoaded: `${pluginName} 已加载`,
	filePilotRibbonTooltip: `打开${pluginName}管理面板`,
	restorDefault: `恢复默认`,
	clear: '清空',
	import: '导入',
	export: '导出',


	scanRootName: `项目文件夹`,
	scanRootDesc: `${pluginName}管理的本地文件夹`,
	scanRootPlaceholder: `输入文件夹的绝对路径,按回车保存`,
	scanRootBrowse: `浏览`,
	scanRootSave: `保存`,
	scanRootSelect: `选择扫描目录`,

	scanRootSaved: `扫描目录已保存`,
	scanRootInvalid: `请输入有效的绝对目录路径`,
	scanRootNotFound: `目录不存在或无法访问`,
	scanRootLocked:
		'已有文件或文件夹记录，暂不支持修改项目文件夹',
	scanRootSaveFailed: `保存扫描目录失败`,
	scanRootBrowseFailed: `无法打开文件夹选择窗口，请手动输入路径`,
	settingsSave: '保存设置',
	settingsSaved: `设置已保存`,
	settingsPartiallySaved: `部分设置已保存`,
	settingsSaveFailed: `保存设置失败`,
	settingsInvalid: `设置内容无效`,
	ignorePatternsInvalid: `忽略规则格式无效`,
	settingsUnchanged: `设置未更新`,
	ignorePatternsName: `忽略规则`,
	ignorePatternsDesc: `设置不被插件管理的文件或文件夹，规则语法请参考.gitignore，也可以切换模式手动选择`,
	ignoreImportDialogTitle: '导入忽略规则',
	ignoreExportDialogTitle: '导出忽略规则',
	ignoreImportedDraft: '规则已导入，保存设置后生效',
	ignoreImportFailed: '导入忽略规则失败',
	ignoreExported: '忽略规则已导出',
	ignoreExportFailed: '导出忽略规则失败',
	ignoreViewAll: '全部忽略规则',
	ignoreViewDirectories: '忽略文件夹',
	ignoreViewFilenames: '忽略文件名',
	ignoreViewExtensions: '忽略格式',
	ignoreDirectoriesDesc: '查看被忽略扫描的文件夹',
	ignoreFilenamesDesc: '查看被指定忽略扫描的文件',
	ignoreExtensionsDesc: '查看被忽略扫描的文件扩展名',
	ignoreCategoryPlaceholder: '目前暂无匹配内容',
	ignoreRemoveRule: '移除忽略规则',
	ignoreRootRequired: '请先添加并保存项目文件夹，再添加忽略规则',
	ignoreSelectFolders: '选择要忽略的文件夹',
	ignoreSelectFiles: '选择要忽略的文件',
	ignoreOutsideRoot: '只能选择项目文件夹下的文件或文件夹',
	ignoreSelectionFailed: '选择文件或文件夹失败',
	ignoreExtensionInput: '输入要忽略的扩展名',
	ignoreExtensionInvalid:
		'扩展名只能包含英文字母、数字、下划线、连字符及中间的句点',
	ignoreExtensionDuplicate: '该扩展名已存在于忽略规则中',
	projectNameName: '项目名称',
	projectNameDesc: '设置项目名称，留空使用默认名称',
	projectNamePlaceholder: '输入项目名称（可选）',
	projectNameInvalid:
		'项目名称不能超过 30 个字符，不能包含控制字符或 \\ / : * ? " < > |，且不能以句点结尾',

	sync: `${syncButtonName}`,
	scanRootNotConfigured: `请先在插件设置页添加文件夹`,
	scanCompleted:
		'已导入 {fileCount} 个文件、{folderCount} 个文件夹',
	noNewImportedEntries:
		'无新文件或文件夹导入',
	SameNameFile: `文件 {fileName} 的影子笔记存在命名冲突，${pluginName}已在影子笔记后面添加文件ID，强烈建议手动修改文件名`,
	scanFailed: `扫描失败`,
	scanning: `扫描文件夹中`,
	syncAlreadyInProgress: `正在同步中`,
	managedEntryCount:
		'已管理 {fileCount} 个文件、{folderCount} 个文件夹',
	emptyFileList:
		'项目文件夹中暂无受管理的文件或文件夹',
	fileStatusAvailable: '正常',
	fileStatusMissing: '缺失',
	fileStatusIgnored: '被忽略',
	hideShadowNotesName: '隐藏影子笔记文件夹',
	hideShadowNotesDesc:
		'在 Obsidian 原生文件浏览器中隐藏 ShadowNotes 文件夹，不影响笔记的读取和编辑。',
	clearAllData: '清空数据',
	clearAllDataSuccess: `成功清空数据`,
	clearAllDataFailed: '清空数据失败',
	clearInProgress: `正在清空数据`,
	fileSearchPlaceholder: '检索文件名或路径...',
	filterStatusAll: '全部状态',
	filterStatusLabel: '按状态筛选',
	noMatchingFiles: '没有匹配的文件或文件夹',
	// File action feedback
	sourceFileNotFound: '文件或文件夹不存在',
	shadowNoteNotFound: '找不到对应的 Shadow Note',
	sourceFileOpenFailed: '打开文件失败',
	folderOpenFailed: '打开文件夹失败',
	shadowNoteOpenFailed: '打开影子笔记失败',
	fileActionFailed: '文件操作失败',
	//about file summary
	fileSummaryPlaceholder: '添加文件简介…',
	fileSummaryEdit: '编辑文件简介',
	// File reference rendering
	fileReferenceNotFound: '该文件未被记录',
	fileReferenceNotFoundHint: '没有与此引用匹配的受管理文件。',
	fileReferenceCursorMoved: '文件引用插入位置被移动，请重新尝试',
	insertFileReferenceCommand: '文件引用',
	updatePortalNoteTreeCommand: '更新目录树',
	portalNoteUpdated: '目录树已更新',
	portalNoteUnchanged: '目录树已是最新',
	portalNoteUpdateFailed: '更新目录树失败',
	portalNotePathOccupied:
		'无法创建总览笔记：目标路径已被文件夹占用。',
	portalNoteProjectNameChangeFailed:
		'项目名称已保存，但总览笔记重命名或创建失败。',
	portalNoteNotFound:
		`总览笔记不存在，请先点击${syncButtonName}创建总览笔记。`,
	portalNoteCreated: '总览笔记已创建',
	portalNoteMultipleTreeBlocks:
		'Directory Tree 章节中存在多个 file-pilot-tree 代码块，请保留一个后重试。',
	// File graph feedback
	fileGraphUpdated: '文件图谱已更新',
	fileGraphUnchanged: '文件图谱已是最新',
	fileGraphUpdateFailed: '更新文件图谱失败',
	fileGraphRecordMissing:
		'文件图谱节点缺少对应的 FileRecord',
	fileGraphFrontmatterInvalid:
		'笔记属性格式无效',
	fileGraphShadowNoteNotFound:
		'找不到对应的影子笔记',
	fileGraphPortalNoteNotFound:
		`总览笔记不存在，请先点击${syncButtonName}以同步`,
	fileGraphPortalNotePathOccupied:
		'总览笔记路径已被其他对象占用',
	graphOpenSource: '打开源文件',
	graphOpenContainingFolder: '打开所在文件夹',
	fileGraphSelfLink: '节点不能引用自身',
	fileGraphNoteNotFound: '连接涉及的笔记已不存在',
	fileGraphInvalidNoteType: 'file-pilot-links只能在Markdown 笔记间建立联接',
	// Graph relation editor
	graphEditRelations: '编辑图谱关系',
	graphCurrentNode: '当前节点',
	graphIncomingLinks: '入链',
	graphOutgoingLinks: '出链',
	graphAddConnection: '添加',
	graphRemoveConnection: '移除连接',
	graphNoConnections: '暂无连接',
	graphSelectNote: '搜索引用节点...',
	graphOrdinaryLinkTooltip:
		'该文件或笔记可能在正文中，请在笔记内处理。',
} satisfies Record<keyof typeof en, string>;
