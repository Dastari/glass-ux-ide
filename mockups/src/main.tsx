import { StrictMode, useEffect, useState, type ComponentType } from "react"
import { createRoot } from "react-dom/client"
import { ActionProvider } from "glass-ux/actions"
import { AppearanceProvider, configureAppearance, useAppearance } from "glass-ux/appearance"
import { Button } from "glass-ux/button"
import { PaletteProvider } from "glass-ux/command-palette"
import { TooltipProvider } from "glass-ux/tooltip"
import "./app.css"
import "./live.css"
import { registerMessagePack } from "glass-ux/i18n"
import glassArabic from "glass-ux/i18n/ar"
import { LocaleProvider } from "glass-ux/locale"
import ideArabic from "../../src/i18n/ar.ts"
import { LocaleContext } from "./chrome"
import { LiveScreen } from "./live"
import { A11yScreen, BackendScreen, ComponentsScreen, DocsScreen, EmbedScreen, HistoryScreen, HugeScreen, PaletteScreen, RemoteScreen, SplitScreen, WorkbenchScreen } from "./screens"

configureAppearance({
  storageKey: "glass-ux-ide-mockups.appearance.v1",
  defaults: { palette: "ocean", mode: "dark", density: "compact", background: "silk" },
})

const SCREENS: { id: string; label: string; view: ComponentType }[] = [
  { id: "live", label: "Live editor", view: LiveScreen },
  { id: "workbench", label: "Workbench", view: WorkbenchScreen },
  { id: "split", label: "Split, hover", view: SplitScreen },
  { id: "huge", label: "48 GB file", view: HugeScreen },
  { id: "history", label: "History", view: HistoryScreen },
  { id: "remote", label: "Open", view: () => <RemoteScreen dialog /> },
  { id: "conflict", label: "Save conflict", view: () => <RemoteScreen /> },
  { id: "palette", label: "Commands", view: PaletteScreen },
  { id: "embed", label: "In an app", view: EmbedScreen },
  { id: "backend", label: "Runs where", view: BackendScreen },
  { id: "components", label: "Components", view: ComponentsScreen },
  { id: "docs", label: "Docs site", view: DocsScreen },
  { id: "a11y", label: "Accessibility", view: A11yScreen },
]

registerMessagePack(glassArabic)
registerMessagePack(ideArabic)

const params = new URLSearchParams(location.search)
const SHOT = params.has("shot")

function App() {
  const appearance = useAppearance()
  const [screen, setScreen] = useState(() => location.hash.slice(1) || "live")
  const [rtl, setRtl] = useState(params.get("dir") === "rtl")
  const prefs = appearance.appearance

  useEffect(() => {
    const onHash = () => setScreen(location.hash.slice(1) || "live")
    addEventListener("hashchange", onHash)
    return () => removeEventListener("hashchange", onHash)
  }, [])

  useEffect(() => {
    for (const [key, value] of params) if (["mode", "palette", "glass", "style", "density"].includes(key)) appearance.update({ [key]: value })
  }, [])

  useEffect(() => {
    document.documentElement.dir = rtl ? "rtl" : "ltr"
    document.documentElement.lang = rtl ? "ar" : "en-AU"
  }, [rtl])

  const View = SCREENS.find((item) => item.id === screen)?.view ?? WorkbenchScreen
  return (
    <LocaleProvider locale={rtl ? "ar" : "en-AU"}>
    <LocaleContext value={rtl ? "ar" : "en"}>
      <div className="ide-root canvas-ambient">
        <div className="canvas-silk" aria-hidden="true" />
        {SHOT ? null : (
          <nav className="mock-nav" aria-label="Mock-up screens">
            {SCREENS.map((item) => (
              <Button key={item.id} size="xs" variant={item.id === screen ? "secondary" : "ghost"} onClick={() => (location.hash = item.id)}>
                {item.label}
              </Button>
            ))}
            <span className="mock-nav-spacer" />
            <Button size="xs" variant="ghost" onClick={() => appearance.update({ mode: appearance.resolvedMode === "dark" ? "light" : "dark" })}>Light / dark</Button>
            <Button size="xs" variant="ghost" onClick={() => appearance.update({ style: prefs.style === "flat" ? "glass" : "flat" })}>Glass / flat</Button>
            <Button size="xs" variant="ghost" onClick={() => appearance.update({ glass: prefs.glass === "solid" ? "full" : "solid" })}>Solid</Button>
            <Button size="xs" variant="ghost" onClick={() => setRtl((value) => !value)}>Arabic</Button>
          </nav>
        )}
        <div className="mock-stage">
          <View key={screen} />
        </div>
      </div>
    </LocaleContext>
    </LocaleProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppearanceProvider>
      <TooltipProvider>
        <ActionProvider>
          <PaletteProvider>
            <App />
          </PaletteProvider>
        </ActionProvider>
      </TooltipProvider>
    </AppearanceProvider>
  </StrictMode>,
)
