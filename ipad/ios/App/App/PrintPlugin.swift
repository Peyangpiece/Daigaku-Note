import UIKit
import Capacitor

// 印刷（v0.27.11）：iPad だけで使うときの「印刷…」（src/renderer/views/viewer/export.js の printPdf）。
// アプリの中の画面（WKWebView）では window.print() が何もしないので、注釈を描き込んだ PDF を受け取り、
// iOS の印刷の画面（UIPrintInteractionController）で刷る。PDF のまま渡すので、文字は画像にせずにくっきり出る
@objc(PrintPlugin)
public class PrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrintPlugin"
    public let jsName = "Print"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printPdf", returnType: CAPPluginReturnPromise)
    ]

    /// data：PDF の中身（base64）、name：印刷の仕事の名前（プリンターの待ち行列に出る）。戻り：{printed: 刷ったか}
    @objc func printPdf(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("印刷する PDF がありません")
            return
        }
        let name = call.getString("name") ?? "パレットノート"
        DispatchQueue.main.async {
            guard UIPrintInteractionController.canPrint(data) else {
                call.reject("この PDF は印刷できません")
                return
            }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = name
            controller.printInfo = info
            controller.printingItem = data
            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["printed": completed])
                }
            }
            // iPad では吹き出しで出す。起点は画面の右上（ツールバーの「印刷…」のあたり）
            if let view = self.bridge?.viewController?.view {
                let rect = CGRect(x: view.bounds.maxX - 120, y: view.safeAreaInsets.top + 24, width: 1, height: 1)
                controller.present(from: rect, in: view, animated: true, completionHandler: done)
            } else {
                controller.present(animated: true, completionHandler: done)
            }
        }
    }
}

/// アプリの画面。Capacitor の画面に、このアプリだけの機能（印刷）を足す
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrintPlugin())
    }
}
