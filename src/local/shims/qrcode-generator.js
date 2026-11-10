// qrcode-generator の代わり（iPad のアプリ。QR を出すのはパソコンの画面だけ）
export default function qrcode() {
  throw new Error('この操作は iPad ではできません（パソコンで開いてください）');
}
