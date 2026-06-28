export const locales = ["en", "zh"] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "en"

export const localeLabels: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
}

const en = {
  // Navigation
  explore: "Explore",
  studio: "Studio",
  toggleTheme: "Toggle theme",
  toggleLanguage: "Switch language",
  // Studio
  studioTitle: "Studio",
  studioModes: "Modes",
  studioModeChat: "Chat",
  studioModeImage: "Image Generation",
  studioModeVideo: "Video Generation",
  studioModeAudio: "Audio Generation",
  studioSessions: "Sessions",
  studioRecent: "Recent",
  studioNewSession: "New",
  studioSearchSessions: "Search sessions",
  studioNoSessions: "No matching sessions.",
  studioWorkspace: "Workspace",
  studioWorkspaceHint:
    "Choose a mode or session from the sidebar. The main Studio canvas will be built next.",
  // Model square
  modelTypes: "Output type",
  allTypes: "All",
  textModels: "Text",
  imageModels: "Image",
  videoModels: "Video",
  vendors: "Vendors",
  allVendors: "All vendors",
  hot: "Hot",
  searchModels: "Search models",
  sortModels: "Sort models",
  newest: "Newest",
  nameAsc: "Name A-Z",
  nameDesc: "Name Z-A",
  modelsSummary: (visibleCount: number, totalCount: number) =>
    `${visibleCount} shown · ${totalCount} total`,
  noModelsFound: "No models match the current search or filter.",
  noModelDescription: "No model description is available.",
  refresh: "Refresh",
  requestFailed: "Request failed",
  input: "Input",
  output: "Output",
  contextLength: "Context",
  contextAny: "Any",
  updated: "Updated",
  pricing: "Pricing",
  pricingUnavailable: "No public pricing",
  pricingDetails: "Pricing details",
  viewPricingDetails: "View pricing details",
  copyModelId: "Copy model ID",
  copied: "Copied",
  showMore: "Show More",
  showLess: "Show Less",
  none: "None",
} as const

export type Dictionary = {
  [K in keyof typeof en]: (typeof en)[K] extends (...args: never[]) => unknown
    ? (typeof en)[K]
    : string
}

const zh: Dictionary = {
  // Navigation
  explore: "探索",
  studio: "操作台",
  toggleTheme: "切换主题",
  toggleLanguage: "切换语言",
  // Studio
  studioTitle: "操作台",
  studioModes: "模式",
  studioModeChat: "聊天",
  studioModeImage: "图像生成",
  studioModeVideo: "视频生成",
  studioModeAudio: "音频生成",
  studioSessions: "会话记录",
  studioRecent: "最近",
  studioNewSession: "新建",
  studioSearchSessions: "搜索会话",
  studioNoSessions: "没有匹配的会话。",
  studioWorkspace: "工作区",
  studioWorkspaceHint: "先从左侧选择模式或会话。右侧操作区后续继续实现。",
  // Model square
  modelTypes: "输出类型",
  allTypes: "全部",
  textModels: "文本",
  imageModels: "图像",
  videoModels: "视频",
  vendors: "供应商",
  allVendors: "全部供应商",
  hot: "热门",
  searchModels: "搜索模型",
  sortModels: "排序模型",
  newest: "最新",
  nameAsc: "名称 A-Z",
  nameDesc: "名称 Z-A",
  modelsSummary: (visibleCount: number, totalCount: number) =>
    `已显示 ${visibleCount} 个 · 共 ${totalCount} 个`,
  noModelsFound: "没有匹配当前搜索或筛选条件的模型。",
  noModelDescription: "暂无模型描述。",
  refresh: "刷新",
  requestFailed: "请求失败",
  input: "输入",
  output: "输出",
  contextLength: "上下文",
  contextAny: "不限",
  updated: "更新时间",
  pricing: "价格",
  pricingUnavailable: "暂无公开价格",
  pricingDetails: "价格详情",
  viewPricingDetails: "查看价格详情",
  copyModelId: "复制模型 ID",
  copied: "已复制",
  showMore: "展开更多",
  showLess: "收起",
  none: "无",
}

export const dictionaries: Record<Locale, Dictionary> = { en, zh }
