// Reads text in an image (Vision) and speech in a media file (Speech), fully on this Mac.
// Build: swiftc -O reader.swift -o reader
// Use:   reader ocr <image> | reader speech <audio-or-video> <locale> | reader summarize <zh|en> < text | reader locales
import AVFoundation
import Foundation
import FoundationModels
import Speech
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
let mode = args.count > 1 ? args[1] : ""

if mode == "ocr", args.count > 2 {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["zh-Hant", "zh-Hans", "en-US"]
  try VNImageRequestHandler(url: URL(fileURLWithPath: args[2])).perform([request])
  print((request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
} else if mode == "locales" {
  print(await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }.sorted().joined(separator: " "))
} else if mode == "speech", args.count > 3 {
  let wanted = Locale(identifier: args[3])
  guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) else { fail("speech language \(args[3]) is not supported on this Mac") }
  let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
  // First use of a language downloads Apple's on-device model.
  if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
    try await install.downloadAndInstall()
  }
  let analyzer = SpeechAnalyzer(modules: [transcriber])
  let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[2]))
  async let transcript = transcriber.results.reduce(into: "") { $0 += String($1.text.characters) }
  if let end = try await analyzer.analyzeSequence(from: file) {
    try await analyzer.finalizeAndFinish(through: end)
  } else {
    await analyzer.cancelAndFinishNow()
  }
  print(try await transcript)
} else if mode == "summarize" {
  // Post text arrives on stdin; Apple's on-device model writes a title line and a short summary.
  guard case .available = SystemLanguageModel.default.availability else { fail("Apple Intelligence is not available: \(SystemLanguageModel.default.availability)") }
  let post = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let language = args.count > 2 && args[2] == "zh" ? "Traditional Chinese (繁體中文)" : "English"
  // Permissive guardrails: summarising someone else's text, so strong wording in a post is not a reason to refuse.
  let session = LanguageModelSession(model: SystemLanguageModel(guardrails: .permissiveContentTransformations), instructions: """
    You summarise Instagram posts for a personal notes app. Write only in \(language). Plain text only. \
    Line 1: a short headline naming the topic directly, like a note title; never begin with "This post" or "這是". \
    Then 3 to 5 lines, each starting with "- " and each a complete short sentence giving one key point. \
    Keep specific names, places, prices and times exactly as in the post. No labels, no hashtags, no quotes. \
    Use only facts from the post. Leave out requests to follow, like or comment.
    """)
  print(try await session.respond(to: post).content)
} else {
  fail("usage: reader ocr <image> | reader speech <file> <locale> | reader summarize <zh|en> < text | reader locales")
}
