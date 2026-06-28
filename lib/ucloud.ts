import { createHash } from "node:crypto"

const UCLOUD_ENDPOINT = "https://api.ucloud.cn/"

export type UCloudScalarParamValue = string | number | boolean
export type UCloudParamValue =
  UCloudScalarParamValue | readonly UCloudScalarParamValue[]

export type UCloudCredentials = {
  accessKey: string
  secretKey: string
  projectId: string
}

type CallUCloudActionInput = {
  credentials: UCloudCredentials
  params: Record<string, UCloudParamValue>
}

type UCloudErrorPayload = {
  RetCode?: number
  Message?: string
}

export class UCloudApiError extends Error {
  retCode?: number
  status: number

  constructor(
    message: string,
    options?: { retCode?: number; status?: number }
  ) {
    super(message)
    this.name = "UCloudApiError"
    this.retCode = options?.retCode
    this.status = options?.status ?? 502
  }
}

function stringifyParamValue(value: UCloudScalarParamValue) {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function expandParamValues(params: Record<string, UCloudParamValue>) {
  const expanded: Record<string, UCloudScalarParamValue> = {}

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        expanded[`${key}.${index}`] = item
      })
      continue
    }

    expanded[key] = value as UCloudScalarParamValue
  }

  return expanded
}

// UCloud signature: sort params by key, concatenate `key+value`, append the
// private key, then SHA1. See https://docs.ucloud.cn/api/summary/signature
function createUCloudSignature(
  params: Record<string, UCloudScalarParamValue>,
  secretKey: string
) {
  const canonicalString = Object.keys(params)
    .sort()
    .map((key) => `${key}${stringifyParamValue(params[key])}`)
    .join("")

  return createHash("sha1")
    .update(`${canonicalString}${secretKey}`, "utf8")
    .digest("hex")
}

export async function callUCloudAction<T>({
  credentials,
  params,
}: CallUCloudActionInput) {
  const signedParams = expandParamValues({
    ...params,
    PublicKey: credentials.accessKey,
  })
  const body = {
    ...signedParams,
    Signature: createUCloudSignature(signedParams, credentials.secretKey),
  }

  let response: Response

  try {
    response = await fetch(UCLOUD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new UCloudApiError("Unable to reach UCloud.")
  }

  let data: T & UCloudErrorPayload

  try {
    data = (await response.json()) as T & UCloudErrorPayload
  } catch {
    throw new UCloudApiError("UCloud returned an invalid response.", {
      status: response.ok ? 502 : response.status,
    })
  }

  if (!response.ok || data.RetCode !== 0) {
    throw new UCloudApiError(data.Message || "UCloud request failed.", {
      retCode: data.RetCode,
      status: response.ok ? 400 : response.status,
    })
  }

  return data
}
