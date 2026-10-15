import type { en } from './en';
const pluginName = 'File Pilot'
export const zh = {
	pluginTitle: pluginName,
	pluginLoaded: `${pluginName} 已加载`,
	filePilotRibbonTooltip: `打开${pluginName}监控面板`,


	scanRootName: `项目文件夹`,
	scanRootDesc: `${pluginName}管理的本地文件夹`,
	scanRootPlaceholder: `输入文件夹的绝对路径，按回车确认`,
	scanRootBrowse: `浏览`,
	scanRootSave: `保存`,
	scanRootSelect: `选择扫描目录`,

	scanRootSaved: `扫描目录已保存`,
	scanRootInvalid: `请输入有效的绝对目录路径`,
	scanRootNotFound: `目录不存在或无法访问`,
	scanRootLocked: `已有文件记录，暂不支持修改扫描根目录`,
	scanRootSaveFailed: `保存扫描目录失败`,
	scanRootBrowseFailed: `无法打开文件夹选择窗口，请手动输入路径`,

	oneWayScan: `单向扫描`,
	scanRootNotConfigured: `请先在插件设置页添加文件夹`,
	scanCompleted: `已导入 {count} 个文件`,
	SameNameFile: `文件 {fileName} 的影子笔记存在命名冲突，${pluginName}已在影子笔记后面添加UUID，强烈建议手动修改文件名`,
	scanFailed: `扫描失败`,
	scanning: `扫描文件夹中`,
	syncAlreadyInProgress: `正在同步中`,
} satisfies Record<keyof typeof en, string>;
