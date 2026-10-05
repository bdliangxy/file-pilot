export interface FileRecord {
	id: string;	//插件内部稳定主键，用于内部引用；

	path: string; //这里写相对于FileScope的相对路径

	nativeIdentity?: string; //文件系统提供的辅助识别信息

	baseName: string; //文件名，不包含路径和扩展名
	extension: string | null; //文件扩展名，不包含点号

	size: number; //文件大小，以字节为单位
	mtimeMs: number; //文件修改时间，以毫秒为单位

	shadowNotePath: string; //相对于 Vault 根目录的路径
}

export interface FileScope {
	rootPath: string;	//管理哪个真实文件夹

	ignorePatterns: string[]; //用 ignore 排除不需要的内容

	watchEnabled: boolean; //如果当前文件夹中文件操作比较频繁，用户可以暂时关闭实时监听，文件操作结束后再开启
}
