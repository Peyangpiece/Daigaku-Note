// パソコンと同じ画面（iPad。docs/MOBILE.md §8）の入口：パソコンとのやりとり（window.daigaku）を用意してから、パソコンの画面（app.js）を読む。
// つないでいない・パソコンでオンにしていないときは、案内だけを出して app.js は読まない
import {installBridge} from './bridge.js';

if (await installBridge()) await import('/p/src/renderer/app.js');
