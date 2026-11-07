// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { useVoiceInput, type VoiceRpc } from "./use-voice-input.js"
import { startRecording, type VoiceRecording } from "./voice-capture.js"

vi.mock("./voice-capture.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./voice-capture.js")>(),
  startRecording: vi.fn()
}))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const fakeRpc = (superwhisper = false): VoiceRpc => ({
  voiceRequestMicrophone: vi.fn(async () => true),
  voiceTranscribe: vi.fn(async () => ({ text: "hello" })),
  voiceSuperwhisperInstalled: vi.fn(async () => superwhisper),
  voiceSuperwhisperRecord: vi.fn(async () => {})
})
const fakeRecording = () => ({ stop: vi.fn(async () => "d2F2"), cancel: vi.fn(), level: () => 0 })
const render = (rpc: VoiceRpc, config?: { voice: { holdKey: string } }) => renderHook(() => useVoiceInput(vi.fn(), rpc, config))

it("cancels a live capture when the composer unmounts", async () => {
  const recording = fakeRecording()
  vi.mocked(startRecording).mockResolvedValue(recording)
  const { result, unmount } = render(fakeRpc())
  act(() => result.current.onToggle())
  await waitFor(() => expect(result.current.status).toBe("recording"))
  unmount()
  expect(recording.cancel).toHaveBeenCalledOnce()
  expect(recording.stop).not.toHaveBeenCalled()
})

it("sends Superwhisper its stop link when the composer unmounts", async () => {
  const rpc = fakeRpc(true)
  const { result, unmount } = render(rpc)
  act(() => result.current.onToggle())
  await waitFor(() => expect(result.current.status).toBe("recording"))
  unmount()
  await waitFor(() => expect(rpc.voiceSuperwhisperRecord).toHaveBeenLastCalledWith("stop"))
})

it("cancels a capture that opens after the composer unmounted", async () => {
  const recording = fakeRecording()
  let open: (recording: VoiceRecording) => void = () => {}
  vi.mocked(startRecording).mockReturnValue(new Promise((resolve) => { open = resolve }))
  const { result, unmount } = render(fakeRpc())
  act(() => result.current.onToggle())
  await waitFor(() => expect(startRecording).toHaveBeenCalled())
  unmount()
  open(recording)
  await waitFor(() => expect(recording.cancel).toHaveBeenCalledOnce())
})

it("leaves a capture already being transcribed alone on unmount", async () => {
  const recording = fakeRecording()
  recording.stop.mockReturnValue(new Promise(() => {}))
  vi.mocked(startRecording).mockResolvedValue(recording)
  const { result, unmount } = render(fakeRpc())
  act(() => result.current.onToggle())
  await waitFor(() => expect(result.current.status).toBe("recording"))
  act(() => result.current.onToggle())
  await waitFor(() => expect(result.current.status).toBe("transcribing"))
  unmount()
  expect(recording.stop).toHaveBeenCalledOnce()
  expect(recording.cancel).not.toHaveBeenCalled()
})

it("holds the configured key to talk, and removes its listeners on unmount", async () => {
  vi.mocked(startRecording).mockImplementation(async () => fakeRecording())
  const add = vi.spyOn(window, "addEventListener")
  const remove = vi.spyOn(window, "removeEventListener")
  const { result, unmount } = render(fakeRpc(), { voice: { holdKey: "F8" } })
  const listeners = add.mock.calls.filter(([type]) => type === "keydown" || type === "keyup")
  expect(listeners).toHaveLength(2)
  fireEvent.keyDown(window, { code: "F9" })
  expect(result.current.status).toBe("idle")
  fireEvent.keyDown(window, { code: "F8" })
  await waitFor(() => expect(result.current.status).toBe("recording"))
  fireEvent.keyUp(window, { code: "F8" })
  await waitFor(() => expect(result.current.status).toBe("idle"))
  unmount()
  for (const [type, listener] of listeners) expect(remove).toHaveBeenCalledWith(type, listener)
  add.mockRestore()
  remove.mockRestore()
})

it("hands the transcript to the latest onText, not the one from first render", async () => {
  vi.mocked(startRecording).mockImplementation(async () => fakeRecording())
  const first = vi.fn()
  const latest = vi.fn()
  const rpc = fakeRpc()
  const { result, rerender } = renderHook(({ onText }) => useVoiceInput(onText, rpc), { initialProps: { onText: first } })
  rerender({ onText: latest })
  act(() => result.current.onToggle())
  await waitFor(() => expect(result.current.status).toBe("recording"))
  act(() => result.current.onToggle())
  await waitFor(() => expect(latest).toHaveBeenCalledOnce())
  expect(first).not.toHaveBeenCalled()
})
