export const skillOrderByOptions = ["popular", "recent"] as const

export type SkillOrderBy = (typeof skillOrderByOptions)[number]

export type SkillMeta = {
  Slug?: string
  Version?: string
  Name?: string
  Author?: string
  Desc?: string
  DescZh?: string
  Category?: string
  Downloads?: number
  FileCount?: number
  SizeBytes?: number
  ArchiveUrl?: string
  UpStreamUrl?: string
  UpStreamUpdatedAt?: number
  FilesJson?: string
  SkillMdUrl?: string
  UpStream?: string
  Latest?: boolean
}

export type DescribeSkillMarketResponse = {
  RetCode: number
  Action: string
  Message?: string
  TotalCount: number
  Skills: SkillMeta[]
  AllCategories: string[]
}

export type DescribeSkillDetailResponse = {
  RetCode: number
  Action: string
  Message?: string
  Skill: SkillMeta
  SkillMd: string
}

export type SkillMarketApiResponse =
  | {
      ok: true
      data: SkillMeta[]
      totalCount: number
      allCategories: string[]
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export type SkillDetailApiResponse =
  | {
      ok: true
      data: {
        skill: SkillMeta
        skillMd: string
      }
    }
  | {
      ok: false
      message: string
      retCode?: number
    }

export function isSkillOrderBy(value: string): value is SkillOrderBy {
  return skillOrderByOptions.includes(value as SkillOrderBy)
}
