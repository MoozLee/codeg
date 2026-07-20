"use client"

import { createContext, useCallback, useEffect, useRef, useState } from "react"
import {
  getSystemFontSettings,
  listSystemFontFamilies,
  updateSystemFontSettings,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import {
  THEME_COLORS,
  DEFAULT_THEME_COLOR,
  DEFAULT_ZOOM_LEVEL,
  FALLBACK_SYSTEM_FONT_FAMILY_LIST,
  ZOOM_LEVELS,
  normalizeFontFamilyPreference,
  normalizeSystemFontFamilyList,
  type ThemeColor,
  type ZoomLevel,
} from "@/lib/theme-presets"
import {
  CUSTOM_FONT_ID,
  resolveFontStack,
  isValidFontId,
  isValidFontSize,
  systemFontFamilyFromId,
  DEFAULT_UI_FONT_ID,
  DEFAULT_EDITOR_FONT_ID,
  DEFAULT_TERMINAL_FONT_ID,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_SIZE,
  type FontSize,
} from "@/lib/font-presets"
import {
  STORAGE_KEY_CODE_FONT_FAMILY,
  STORAGE_KEY_THEME_COLOR,
  STORAGE_KEY_UI_FONT_FAMILY,
  STORAGE_KEY_ZOOM_LEVEL,
  STORAGE_KEY_WELCOME_QUICK_ACTIONS,
  STORAGE_KEY_UI_FONT,
  STORAGE_KEY_UI_FONT_CUSTOM,
  STORAGE_KEY_UI_FONT_STACK,
  STORAGE_KEY_EDITOR_FONT,
  STORAGE_KEY_EDITOR_FONT_CUSTOM,
  STORAGE_KEY_EDITOR_FONT_SIZE,
  STORAGE_KEY_EDITOR_LIGATURES,
  STORAGE_KEY_EDITOR_WORD_WRAP,
  STORAGE_KEY_TERMINAL_FONT,
  STORAGE_KEY_TERMINAL_FONT_CUSTOM,
  STORAGE_KEY_TERMINAL_FONT_SIZE,
  STORAGE_KEY_TERMINAL_LIGATURES,
  STORAGE_KEY_WORKSPACE_BG_ENABLED,
  STORAGE_KEY_WORKSPACE_BG_MASK,
  STORAGE_KEY_WORKSPACE_BG_BLUR,
  STORAGE_KEY_WORKSPACE_BG_FILL,
  STORAGE_KEY_WORKSPACE_BG_PANEL_OPACITY,
  STORAGE_KEY_WORKSPACE_BG_IMAGE_VERSION,
} from "@/lib/appearance-script"
import type { SystemFontFamilyList } from "@/lib/types"

const FONT_PERSIST_DELAY_MS = 200

import {
  DEFAULT_WORKSPACE_BG_ENABLED,
  DEFAULT_WORKSPACE_BG_MASK_OPACITY,
  DEFAULT_WORKSPACE_BG_IMAGE_BLUR,
  DEFAULT_WORKSPACE_BG_PANEL_OPACITY,
  DEFAULT_WORKSPACE_BG_FILL_MODE,
  clampMaskOpacity,
  clampImageBlur,
  clampPanelOpacity,
  isValidFillMode,
  createBackgroundObjectUrl,
  revokeBackgroundObjectUrl,
  readWorkspaceBackground,
  setWorkspaceBackground,
  clearWorkspaceBackground,
  type WorkspaceBgFillMode,
} from "@/lib/workspace-background"

function syncTrafficLightPosition(zoom: number) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return
  }

  import("@/lib/tauri").then((t) =>
    t.updateTrafficLightPosition(zoom).catch(() => {})
  )
}

function syncAppearanceMode(mode: string) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return
  }

  import("@/lib/tauri").then((t) =>
    t.updateAppearanceMode(mode).catch(() => {})
  )
}

export type FontSelection = { id: string; custom: string }

type AppearanceContextValue = {
  themeColor: ThemeColor
  setThemeColor: (color: ThemeColor) => void
  zoomLevel: ZoomLevel
  setZoomLevel: (zoom: ZoomLevel) => void
  /** 新会话欢迎页是否显示「模式选择区域」（QuickActions 快捷卡片），默认开启 */
  showWelcomeQuickActions: boolean
  setShowWelcomeQuickActions: (on: boolean) => void
  /** 界面字体（普通组件，驱动 --font-sans） */
  uiFont: FontSelection
  setUiFont: (id: string, custom?: string) => void
  /** 编辑器字体（仅作用于代码编辑器 Monaco 的 fontFamily） */
  editorFont: FontSelection
  setEditorFont: (id: string, custom?: string) => void
  terminalFont: FontSelection
  setTerminalFont: (id: string, custom?: string) => void
  editorFontSize: FontSize
  setEditorFontSize: (size: FontSize) => void
  terminalFontSize: FontSize
  setTerminalFontSize: (size: FontSize) => void
  editorLigatures: boolean
  setEditorLigatures: (on: boolean) => void
  /** 编辑器自动换行（作用于代码编辑器 Monaco 的 wordWrap 选项） */
  editorWordWrap: boolean
  setEditorWordWrap: (on: boolean) => void
  terminalLigatures: boolean
  setTerminalLigatures: (on: boolean) => void
  fontList: SystemFontFamilyList
  fontListLoaded: boolean
  fontListError: string | null
  /** Workspace 背景图片总开关。关闭时不加载图片、不触发任何表面半透明。 */
  workspaceBgEnabled: boolean
  setWorkspaceBgEnabled: (on: boolean) => void
  /** 暗化遮罩不透明度（朝 --background 的面纱，明暗自适配），0–0.9。 */
  workspaceBgMaskOpacity: number
  setWorkspaceBgMaskOpacity: (v: number) => void
  /** 背景图片模糊半径（px），0–24。 */
  workspaceBgImageBlur: number
  setWorkspaceBgImageBlur: (v: number) => void
  /** 结构性面板（侧栏/面板/标签条）不透明度，驱动 --ws-surface-alpha，0.3–1。 */
  workspaceBgPanelOpacity: number
  setWorkspaceBgPanelOpacity: (v: number) => void
  /** 背景图片填充模式（cover/contain/center/tile）。 */
  workspaceBgFillMode: WorkspaceBgFillMode
  setWorkspaceBgFillMode: (mode: WorkspaceBgFillMode) => void
  /** 已解析的背景图片 blob URL（异步从磁盘加载），无图为 null。 */
  workspaceBgImageUrl: string | null
  /** 上传并设置背景图片（base64）。写盘后重新读回并建 blob URL。 */
  setWorkspaceBackgroundImage: (imageBase64: string) => Promise<void>
  /** 移除背景图片（删盘 + revoke blob URL）。 */
  removeWorkspaceBackground: () => Promise<void>
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(
  null
)

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式 / 禁用 storage 时静默忽略，本次会话内仍然生效
  }
}

function removeStored(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // 隐私模式 / 禁用 storage 时静默忽略，本次会话内仍然生效
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLegacyFontFamily(key: string, value: string | null) {
  if (value) {
    persist(key, value)
  } else {
    removeStored(key)
  }
}

function legacyFontFamilyFromSelection({
  id,
  custom,
}: FontSelection): string | null {
  if (id === CUSTOM_FONT_ID) {
    return normalizeFontFamilyPreference(custom)
  }
  return systemFontFamilyFromId(id)
}

function readFontSelection(
  idKey: string,
  customKey: string,
  def: string
): FontSelection {
  if (typeof document === "undefined") return { id: def, custom: "" }
  try {
    const id = localStorage.getItem(idKey)
    const custom = localStorage.getItem(customKey) ?? ""
    return { id: isValidFontId(id) ? (id as string) : def, custom }
  } catch {
    return { id: def, custom: "" }
  }
}

function readFontSize(key: string, def: FontSize): FontSize {
  if (typeof document === "undefined") return def
  try {
    const n = parseInt(localStorage.getItem(key) ?? "", 10)
    return isValidFontSize(n) ? n : def
  } catch {
    return def
  }
}

function readBool(key: string, def: boolean): boolean {
  if (typeof document === "undefined") return def
  try {
    const v = localStorage.getItem(key)
    return v === null ? def : v === "1"
  } catch {
    return def
  }
}

function readNumber(
  key: string,
  def: number,
  clampFn: (v: number) => number
): number {
  if (typeof document === "undefined") return def
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return def
    const n = parseFloat(raw)
    return Number.isNaN(n) ? def : clampFn(n)
  } catch {
    return def
  }
}

function readWorkspaceBgFillMode(): WorkspaceBgFillMode {
  if (typeof document === "undefined") return DEFAULT_WORKSPACE_BG_FILL_MODE
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WORKSPACE_BG_FILL)
    return isValidFillMode(raw) ? raw : DEFAULT_WORKSPACE_BG_FILL_MODE
  } catch {
    return DEFAULT_WORKSPACE_BG_FILL_MODE
  }
}

/**
 * AppearanceProvider 管理 themeColor、zoomLevel 与字体偏好。
 *
 * 与 next-themes 完全正交：next-themes 负责 <html class="dark/light">，
 * 这里负责 <html data-theme="...">、<html style="font-size: ...">
 * 以及界面字体变量 --font-sans（编辑器/终端字体只走各自的 Monaco/xterm 选项）。
 *
 * 注意：next-themes 的 attribute 配置必须保持 "class"。如果改为 "data-theme"
 * 会与本 Provider 冲突，导致主题色无法生效。
 */
export function AppearanceProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [themeColor, setThemeColorState] = useState<ThemeColor>(() => {
    if (typeof document === "undefined") return DEFAULT_THEME_COLOR
    const attr = document.documentElement.getAttribute(
      "data-theme"
    ) as ThemeColor | null
    return attr && (THEME_COLORS as readonly string[]).includes(attr)
      ? attr
      : DEFAULT_THEME_COLOR
  })

  const [zoomLevel, setZoomLevelState] = useState<ZoomLevel>(() => {
    if (typeof document === "undefined") return DEFAULT_ZOOM_LEVEL
    const px = parseFloat(document.documentElement.style.fontSize || "16")
    const level = Math.round((px / 16) * 100) as ZoomLevel
    return (ZOOM_LEVELS as readonly number[]).includes(level)
      ? level
      : DEFAULT_ZOOM_LEVEL
  })

  // 新会话「模式选择区域」显示开关：默认开启，键缺失即回退为 true。
  // QuickActions 仅在欢迎态客户端渲染，此处同步读 localStorage 不会造成首帧闪烁。
  const [showWelcomeQuickActions, setShowWelcomeQuickActionsState] =
    useState<boolean>(() => readBool(STORAGE_KEY_WELCOME_QUICK_ACTIONS, true))

  // 字体偏好的初始值从 localStorage 读 id/custom（视觉已由 inline 脚本就位，
  // 这里只是回填选中态，不会造成闪烁）。
  const [uiFont, setUiFontState] = useState<FontSelection>(() =>
    readFontSelection(
      STORAGE_KEY_UI_FONT,
      STORAGE_KEY_UI_FONT_CUSTOM,
      DEFAULT_UI_FONT_ID
    )
  )
  const [editorFont, setEditorFontState] = useState<FontSelection>(() =>
    readFontSelection(
      STORAGE_KEY_EDITOR_FONT,
      STORAGE_KEY_EDITOR_FONT_CUSTOM,
      DEFAULT_EDITOR_FONT_ID
    )
  )
  const [terminalFont, setTerminalFontState] = useState<FontSelection>(() =>
    readFontSelection(
      STORAGE_KEY_TERMINAL_FONT,
      STORAGE_KEY_TERMINAL_FONT_CUSTOM,
      DEFAULT_TERMINAL_FONT_ID
    )
  )
  const [editorFontSize, setEditorFontSizeState] = useState<FontSize>(() =>
    readFontSize(STORAGE_KEY_EDITOR_FONT_SIZE, DEFAULT_EDITOR_FONT_SIZE)
  )
  const [terminalFontSize, setTerminalFontSizeState] = useState<FontSize>(() =>
    readFontSize(STORAGE_KEY_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_FONT_SIZE)
  )
  const [editorLigatures, setEditorLigaturesState] = useState<boolean>(() =>
    readBool(STORAGE_KEY_EDITOR_LIGATURES, false)
  )
  const [editorWordWrap, setEditorWordWrapState] = useState<boolean>(() =>
    readBool(STORAGE_KEY_EDITOR_WORD_WRAP, false)
  )
  const [terminalLigatures, setTerminalLigaturesState] = useState<boolean>(() =>
    readBool(STORAGE_KEY_TERMINAL_LIGATURES, false)
  )
  const [fontList, setFontList] = useState<SystemFontFamilyList>(() =>
    normalizeSystemFontFamilyList(FALLBACK_SYSTEM_FONT_FAMILY_LIST)
  )
  const [fontListLoaded, setFontListLoaded] = useState(false)
  const [fontListError, setFontListError] = useState<string | null>(null)

  const persistTimerRef = useRef<number | null>(null)
  const legacyFontSettingsRef = useRef({
    uiFontFamily: legacyFontFamilyFromSelection(uiFont),
    codeFontFamily: legacyFontFamilyFromSelection(editorFont),
  })

  const schedulePersistFontSettings = useCallback(() => {
    if (typeof window === "undefined") return
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      updateSystemFontSettings({
        ui_font_family: legacyFontSettingsRef.current.uiFontFamily,
        code_font_family: legacyFontSettingsRef.current.codeFontFamily,
      }).catch(() => {})
    }, FONT_PERSIST_DELAY_MS)
  }, [])

  // Workspace 背景图片配置（图片 URL 异步加载，初始 null）。
  const [workspaceBgEnabled, setWorkspaceBgEnabledState] = useState<boolean>(
    () =>
      readBool(STORAGE_KEY_WORKSPACE_BG_ENABLED, DEFAULT_WORKSPACE_BG_ENABLED)
  )
  const [workspaceBgMaskOpacity, setWorkspaceBgMaskOpacityState] =
    useState<number>(() =>
      readNumber(
        STORAGE_KEY_WORKSPACE_BG_MASK,
        DEFAULT_WORKSPACE_BG_MASK_OPACITY,
        clampMaskOpacity
      )
    )
  const [workspaceBgImageBlur, setWorkspaceBgImageBlurState] = useState<number>(
    () =>
      readNumber(
        STORAGE_KEY_WORKSPACE_BG_BLUR,
        DEFAULT_WORKSPACE_BG_IMAGE_BLUR,
        clampImageBlur
      )
  )
  const [workspaceBgPanelOpacity, setWorkspaceBgPanelOpacityState] =
    useState<number>(() =>
      readNumber(
        STORAGE_KEY_WORKSPACE_BG_PANEL_OPACITY,
        DEFAULT_WORKSPACE_BG_PANEL_OPACITY,
        clampPanelOpacity
      )
    )
  const [workspaceBgFillMode, setWorkspaceBgFillModeState] =
    useState<WorkspaceBgFillMode>(() => readWorkspaceBgFillMode())
  const [workspaceBgImageUrl, setWorkspaceBgImageUrlState] = useState<
    string | null
  >(null)

  const setThemeColor = useCallback((color: ThemeColor) => {
    setThemeColorState(color)
    document.documentElement.setAttribute("data-theme", color)
    persist(STORAGE_KEY_THEME_COLOR, color)
  }, [])

  const setZoomLevel = useCallback((zoom: ZoomLevel) => {
    setZoomLevelState(zoom)
    document.documentElement.style.fontSize = `${(16 * zoom) / 100}px`
    syncTrafficLightPosition(zoom)
    persist(STORAGE_KEY_ZOOM_LEVEL, String(zoom))
  }, [])

  const setShowWelcomeQuickActions = useCallback((on: boolean) => {
    setShowWelcomeQuickActionsState(on)
    persist(STORAGE_KEY_WELCOME_QUICK_ACTIONS, on ? "1" : "0")
  }, [])

  const setUiFont = useCallback(
    (id: string, custom = "") => {
      setUiFontState({ id, custom })
      const stack = resolveFontStack(id, custom, "sans")
      const legacyFontFamily = legacyFontFamilyFromSelection({ id, custom })
      document.documentElement.style.setProperty("--font-sans", stack)
      persist(STORAGE_KEY_UI_FONT, id)
      persist(STORAGE_KEY_UI_FONT_CUSTOM, custom)
      persist(STORAGE_KEY_UI_FONT_STACK, stack)
      writeLegacyFontFamily(STORAGE_KEY_UI_FONT_FAMILY, legacyFontFamily)
      legacyFontSettingsRef.current = {
        ...legacyFontSettingsRef.current,
        uiFontFamily: legacyFontFamily,
      }
      schedulePersistFontSettings()
    },
    [schedulePersistFontSettings]
  )

  const setEditorFont = useCallback(
    (id: string, custom = "") => {
      setEditorFontState({ id, custom })
      const legacyFontFamily = legacyFontFamilyFromSelection({ id, custom })
      // 编辑器字体只作用于代码编辑器（Monaco），不写任何全局 CSS 变量，
      // 不影响界面与会话消息区（它们跟随 --font-sans）。
      persist(STORAGE_KEY_EDITOR_FONT, id)
      persist(STORAGE_KEY_EDITOR_FONT_CUSTOM, custom)
      writeLegacyFontFamily(STORAGE_KEY_CODE_FONT_FAMILY, legacyFontFamily)
      legacyFontSettingsRef.current = {
        ...legacyFontSettingsRef.current,
        codeFontFamily: legacyFontFamily,
      }
      schedulePersistFontSettings()
    },
    [schedulePersistFontSettings]
  )

  const setTerminalFont = useCallback((id: string, custom = "") => {
    setTerminalFontState({ id, custom })
    persist(STORAGE_KEY_TERMINAL_FONT, id)
    persist(STORAGE_KEY_TERMINAL_FONT_CUSTOM, custom)
  }, [])

  const setEditorFontSize = useCallback((size: FontSize) => {
    setEditorFontSizeState(size)
    persist(STORAGE_KEY_EDITOR_FONT_SIZE, String(size))
  }, [])

  const setTerminalFontSize = useCallback((size: FontSize) => {
    setTerminalFontSizeState(size)
    persist(STORAGE_KEY_TERMINAL_FONT_SIZE, String(size))
  }, [])

  const setEditorLigatures = useCallback((on: boolean) => {
    setEditorLigaturesState(on)
    persist(STORAGE_KEY_EDITOR_LIGATURES, on ? "1" : "0")
  }, [])

  const setEditorWordWrap = useCallback((on: boolean) => {
    setEditorWordWrapState(on)
    persist(STORAGE_KEY_EDITOR_WORD_WRAP, on ? "1" : "0")
  }, [])

  const setTerminalLigatures = useCallback((on: boolean) => {
    setTerminalLigaturesState(on)
    persist(STORAGE_KEY_TERMINAL_LIGATURES, on ? "1" : "0")
  }, [])

  useEffect(() => {
    let cancelled = false

    void listSystemFontFamilies()
      .then((loadedFontList) => {
        if (cancelled) return
        setFontList(normalizeSystemFontFamilyList(loadedFontList))
        setFontListError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setFontList(
          normalizeSystemFontFamilyList(FALLBACK_SYSTEM_FONT_FAMILY_LIST)
        )
        setFontListError(toErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setFontListLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const hasNewUiFont = readStored(STORAGE_KEY_UI_FONT) !== null
      const hasNewEditorFont = readStored(STORAGE_KEY_EDITOR_FONT) !== null
      const hasNewTerminalFont = readStored(STORAGE_KEY_TERMINAL_FONT) !== null
      if (hasNewUiFont && hasNewEditorFont && hasNewTerminalFont) return

      const settings = await getSystemFontSettings().catch(() => null)
      if (cancelled) return

      const legacyUiFont = normalizeFontFamilyPreference(
        readStored(STORAGE_KEY_UI_FONT_FAMILY) ?? settings?.ui_font_family
      )
      const legacyCodeFont = normalizeFontFamilyPreference(
        readStored(STORAGE_KEY_CODE_FONT_FAMILY) ?? settings?.code_font_family
      )

      if (!hasNewUiFont && legacyUiFont) setUiFont(CUSTOM_FONT_ID, legacyUiFont)
      if (!hasNewEditorFont && legacyCodeFont)
        setEditorFont(CUSTOM_FONT_ID, legacyCodeFont)
      if (!hasNewTerminalFont && legacyCodeFont)
        setTerminalFont(CUSTOM_FONT_ID, legacyCodeFont)
    })()

    return () => {
      cancelled = true
    }
  }, [setEditorFont, setTerminalFont, setUiFont])

  // enabled 与 panelOpacity 的 DOM 应用（data-workspace-bg 属性 + --ws-surface-alpha）
  // 统一交给下方一个 effect，覆盖 mount、重启后 re-enable、跨标签所有路径。setter 只
  // 更新 state + 持久化，避免 --ws-surface-alpha 与 state 失同步。
  const setWorkspaceBgEnabled = useCallback((on: boolean) => {
    setWorkspaceBgEnabledState(on)
    persist(STORAGE_KEY_WORKSPACE_BG_ENABLED, on ? "1" : "0")
  }, [])

  const setWorkspaceBgMaskOpacity = useCallback((v: number) => {
    const clamped = clampMaskOpacity(v)
    setWorkspaceBgMaskOpacityState(clamped)
    persist(STORAGE_KEY_WORKSPACE_BG_MASK, String(clamped))
  }, [])

  const setWorkspaceBgImageBlur = useCallback((v: number) => {
    const clamped = clampImageBlur(v)
    setWorkspaceBgImageBlurState(clamped)
    persist(STORAGE_KEY_WORKSPACE_BG_BLUR, String(clamped))
  }, [])

  const setWorkspaceBgPanelOpacity = useCallback((v: number) => {
    const clamped = clampPanelOpacity(v)
    setWorkspaceBgPanelOpacityState(clamped)
    persist(STORAGE_KEY_WORKSPACE_BG_PANEL_OPACITY, String(clamped))
  }, [])

  const setWorkspaceBgFillMode = useCallback((mode: WorkspaceBgFillMode) => {
    setWorkspaceBgFillModeState(mode)
    persist(STORAGE_KEY_WORKSPACE_BG_FILL, mode)
  }, [])

  const reloadGenRef = useRef(0)
  const reloadWorkspaceBackgroundImage = useCallback(async () => {
    const gen = ++reloadGenRef.current
    try {
      const asset = await readWorkspaceBackground()
      if (gen !== reloadGenRef.current) return
      setWorkspaceBgImageUrlState((prev) => {
        revokeBackgroundObjectUrl(prev)
        return asset ? createBackgroundObjectUrl(asset) : null
      })
    } catch {
      // 读盘失败静默（无背景即可）。
    }
  }, [])

  const setWorkspaceBackgroundImage = useCallback(
    async (imageBase64: string) => {
      await setWorkspaceBackground(imageBase64)
      persist(STORAGE_KEY_WORKSPACE_BG_IMAGE_VERSION, String(Date.now()))
      await reloadWorkspaceBackgroundImage()
    },
    [reloadWorkspaceBackgroundImage]
  )

  const removeWorkspaceBackground = useCallback(async () => {
    await clearWorkspaceBackground()
    reloadGenRef.current += 1
    persist(STORAGE_KEY_WORKSPACE_BG_IMAGE_VERSION, String(Date.now()))
    setWorkspaceBgImageUrlState((prev) => {
      revokeBackgroundObjectUrl(prev)
      return null
    })
  }, [])
  useEffect(() => {
    syncTrafficLightPosition(zoomLevel)
    try {
      syncAppearanceMode(localStorage.getItem("theme") ?? "system")
    } catch {
      // localStorage unavailable
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 仅界面字体需要在 mount 时重新解析并应用 --font-sans，吸收跨版本字体目录变更
  // （inline 脚本写入的是旧版本已解析栈，可能与新目录不一致）。仅在确有漂移时才写，
  // 避免每次加载都触发 localStorage 写入与跨标签页 storage 事件。
  // 编辑器/终端字体只走各自的 Monaco/xterm 选项，不在此落 CSS 变量。
  useEffect(() => {
    const sans = resolveFontStack(uiFont.id, uiFont.custom, "sans")
    if (readStored(STORAGE_KEY_UI_FONT_STACK) !== sans) {
      document.documentElement.style.setProperty("--font-sans", sans)
      persist(STORAGE_KEY_UI_FONT_STACK, sans)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // enabled + panelOpacity 的 DOM 单一同步点：属性驱动 globals.css 的半透明规则，
  // CSS 变量驱动面板不透明度。覆盖 mount / 重启后 re-enable / setter / 跨标签，确保
  // DOM 始终与 state 一致。
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-workspace-bg",
      workspaceBgEnabled ? "on" : "off"
    )
    if (workspaceBgEnabled) {
      document.documentElement.style.setProperty(
        "--ws-surface-alpha",
        String(workspaceBgPanelOpacity)
      )
    }
  }, [workspaceBgEnabled, workspaceBgPanelOpacity])

  useEffect(() => {
    if (!workspaceBgEnabled) return
    void reloadWorkspaceBackgroundImage()
  }, [workspaceBgEnabled, reloadWorkspaceBackgroundImage])
  useEffect(() => {
    const FONT_KEYS = new Set<string>([
      STORAGE_KEY_UI_FONT,
      STORAGE_KEY_UI_FONT_CUSTOM,
      STORAGE_KEY_UI_FONT_STACK,
      STORAGE_KEY_EDITOR_FONT,
      STORAGE_KEY_EDITOR_FONT_CUSTOM,
      STORAGE_KEY_EDITOR_FONT_SIZE,
      STORAGE_KEY_EDITOR_LIGATURES,
      STORAGE_KEY_EDITOR_WORD_WRAP,
      STORAGE_KEY_TERMINAL_FONT,
      STORAGE_KEY_TERMINAL_FONT_CUSTOM,
      STORAGE_KEY_TERMINAL_FONT_SIZE,
      STORAGE_KEY_TERMINAL_LIGATURES,
    ])
    const rehydrateFonts = () => {
      const ui = readFontSelection(
        STORAGE_KEY_UI_FONT,
        STORAGE_KEY_UI_FONT_CUSTOM,
        DEFAULT_UI_FONT_ID
      )
      const ed = readFontSelection(
        STORAGE_KEY_EDITOR_FONT,
        STORAGE_KEY_EDITOR_FONT_CUSTOM,
        DEFAULT_EDITOR_FONT_ID
      )
      const tm = readFontSelection(
        STORAGE_KEY_TERMINAL_FONT,
        STORAGE_KEY_TERMINAL_FONT_CUSTOM,
        DEFAULT_TERMINAL_FONT_ID
      )
      setUiFontState(ui)
      setEditorFontState(ed)
      setTerminalFontState(tm)
      setEditorFontSizeState(
        readFontSize(STORAGE_KEY_EDITOR_FONT_SIZE, DEFAULT_EDITOR_FONT_SIZE)
      )
      setTerminalFontSizeState(
        readFontSize(STORAGE_KEY_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_FONT_SIZE)
      )
      setEditorLigaturesState(readBool(STORAGE_KEY_EDITOR_LIGATURES, false))
      setEditorWordWrapState(readBool(STORAGE_KEY_EDITOR_WORD_WRAP, false))
      setTerminalLigaturesState(readBool(STORAGE_KEY_TERMINAL_LIGATURES, false))
      legacyFontSettingsRef.current = {
        uiFontFamily: legacyFontFamilyFromSelection(ui),
        codeFontFamily: legacyFontFamilyFromSelection(ed),
      }
      // 仅界面字体落到 --font-sans；编辑器/终端字体由各自组件读取 provider 状态后应用。
      document.documentElement.style.setProperty(
        "--font-sans",
        resolveFontStack(ui.id, ui.custom, "sans")
      )
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY_THEME_COLOR && event.newValue) {
        const color = event.newValue as ThemeColor
        if ((THEME_COLORS as readonly string[]).includes(color)) {
          setThemeColorState(color)
          document.documentElement.setAttribute("data-theme", color)
        }
      }

      if (event.key === STORAGE_KEY_ZOOM_LEVEL && event.newValue) {
        const zoom = parseInt(event.newValue, 10) as ZoomLevel
        if ((ZOOM_LEVELS as readonly number[]).includes(zoom)) {
          setZoomLevelState(zoom)
          document.documentElement.style.fontSize = `${(16 * zoom) / 100}px`
          syncTrafficLightPosition(zoom)
        }
      }

      // "0" 是合法值，故不做 newValue 真值判断，交给 readBool 处理 null→默认。
      if (event.key === STORAGE_KEY_WELCOME_QUICK_ACTIONS) {
        setShowWelcomeQuickActionsState(
          readBool(STORAGE_KEY_WELCOME_QUICK_ACTIONS, true)
        )
      }
      if (event.key && FONT_KEYS.has(event.key)) {
        rehydrateFonts()
      }
      if (event.key === STORAGE_KEY_WORKSPACE_BG_ENABLED) {
        setWorkspaceBgEnabledState(
          readBool(
            STORAGE_KEY_WORKSPACE_BG_ENABLED,
            DEFAULT_WORKSPACE_BG_ENABLED
          )
        )
      }
      if (event.key === STORAGE_KEY_WORKSPACE_BG_PANEL_OPACITY) {
        setWorkspaceBgPanelOpacityState(
          readNumber(
            STORAGE_KEY_WORKSPACE_BG_PANEL_OPACITY,
            DEFAULT_WORKSPACE_BG_PANEL_OPACITY,
            clampPanelOpacity
          )
        )
      }
      if (event.key === STORAGE_KEY_WORKSPACE_BG_MASK) {
        setWorkspaceBgMaskOpacityState(
          readNumber(
            STORAGE_KEY_WORKSPACE_BG_MASK,
            DEFAULT_WORKSPACE_BG_MASK_OPACITY,
            clampMaskOpacity
          )
        )
      }
      if (event.key === STORAGE_KEY_WORKSPACE_BG_BLUR) {
        setWorkspaceBgImageBlurState(
          readNumber(
            STORAGE_KEY_WORKSPACE_BG_BLUR,
            DEFAULT_WORKSPACE_BG_IMAGE_BLUR,
            clampImageBlur
          )
        )
      }
      if (event.key === STORAGE_KEY_WORKSPACE_BG_FILL) {
        setWorkspaceBgFillModeState(readWorkspaceBgFillMode())
      }
      if (event.key === STORAGE_KEY_WORKSPACE_BG_IMAGE_VERSION) {
        void reloadWorkspaceBackgroundImage()
      }
      if (event.key === "theme") {
        syncAppearanceMode(event.newValue ?? "system")
      }
    }

    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [reloadWorkspaceBackgroundImage])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [])

  return (
    <AppearanceContext.Provider
      value={{
        themeColor,
        setThemeColor,
        zoomLevel,
        setZoomLevel,
        showWelcomeQuickActions,
        setShowWelcomeQuickActions,
        uiFont,
        setUiFont,
        editorFont,
        setEditorFont,
        terminalFont,
        setTerminalFont,
        editorFontSize,
        setEditorFontSize,
        terminalFontSize,
        setTerminalFontSize,
        editorLigatures,
        setEditorLigatures,
        editorWordWrap,
        setEditorWordWrap,
        terminalLigatures,
        setTerminalLigatures,
        fontList,
        fontListLoaded,
        fontListError,
        workspaceBgEnabled,
        setWorkspaceBgEnabled,
        workspaceBgMaskOpacity,
        setWorkspaceBgMaskOpacity,
        workspaceBgImageBlur,
        setWorkspaceBgImageBlur,
        workspaceBgPanelOpacity,
        setWorkspaceBgPanelOpacity,
        workspaceBgFillMode,
        setWorkspaceBgFillMode,
        workspaceBgImageUrl,
        setWorkspaceBackgroundImage,
        removeWorkspaceBackground,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  )
}
