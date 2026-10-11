import type { en } from './en';

export const zh = {
	pluginLoaded: 'File Pilot 已加载',
	fileCount: '{count} 个文件',

	scanRootName: '扫描根目录',
	scanRootDesc: 'File Pilot 管理的本地文件夹，包括其子文件夹。',
	scanRootPlaceholder: '输入文件夹的绝对路径',
	scanRootBrowse: '浏览',
	scanRootSave: '保存',
	scanRootSelect: '选择扫描目录',

	scanRootSaved: '扫描目录已保存',
	scanRootInvalid: '请输入有效的绝对目录路径',
	scanRootNotFound: '目录不存在或无法访问',
	scanRootLocked: '已有文件记录，暂不支持修改扫描根目录',
	scanRootSaveFailed: '保存扫描目录失败',
	scanRootBrowseFailed: '无法打开文件夹选择窗口，请手动输入路径',
} satisfies Record<keyof typeof en, string>;
