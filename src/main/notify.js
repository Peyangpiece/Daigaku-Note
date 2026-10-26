// OS の通知（SPEC §12.1）。メインからレンダラへ送る知らせ（sync.finished・login.required・quiz.finished）を見て、
// 窓が前面になくても分かるように OS の通知を出す。設定 ui.notifications（既定オン）で止められる。
// 同じ失敗は 1 日 1 回だけ（同期は 1 時間ごとにも走るので、毎回は出さない）。押すとその画面を開く。

import {todayJst} from '../shared/schedule.js';

/**
 * @param {object} deps
 * @param {{getSetting: Function, get: Function}} deps.repo
 * @param {typeof import('electron').Notification} deps.Notification
 * @param {(route?: string|null) => void} deps.openWindow
 * @param {(msg: string) => void} [deps.log]
 * @param {() => Date} [deps.now]
 */
export function createNotifier({repo, Notification, openWindow, log = () => {}, now = () => new Date()}) {
  const shown = new Map(); // 1 日 1 回にする鍵 -> 日付
  const today = () => todayJst(now());
  const enabled = () => repo.getSetting('ui.notifications', true) !== false;

  const show = ({title, body, route = null, oncePerDay = null}) => {
    if (!enabled()) return false;
    if (oncePerDay) {
      if (shown.get(oncePerDay) === today()) return false;
      shown.set(oncePerDay, today());
    }
    try {
      if (Notification.isSupported && !Notification.isSupported()) return false;
      const n = new Notification({title, body: String(body ?? '').slice(0, 200), silent: false});
      n.on('click', () => openWindow(route));
      n.show();
      return true;
    } catch (e) {
      log(`通知を出せませんでした: ${e.message}`);
      return false;
    }
  };

  /** メインからレンダラへの知らせを受けて、必要なら OS の通知を出す。戻りは出したかどうか */
  function onEvent(channel, payload = {}) {
    if (channel === 'sync.finished') {
      if (payload.materials > 0)
        return show({title: '大学ノート', body: `新しい資料 ${payload.materials} 件を保存しました`, route: null});
      if (payload.status === 'failed' || payload.status === 'browser-not-ready')
        return show({
          title: '同期に失敗しました',
          body: payload.message || 'LMS に接続できませんでした',
          route: '/settings',
          oncePerDay: `sync-failed`
        });
      return false;
    }
    if (channel === 'login.required')
      return show({
        title: 'LMS へのログインが必要です',
        body: payload.message || `${payload.label ?? 'LMS'} にログインし直してください（設定 → 大学の LMS）`,
        route: '/settings',
        oncePerDay: `login:${payload.connectionId ?? payload.label ?? ''}`
      });
    if (channel === 'quiz.finished') {
      const round = payload.roundId ? repo.get('round', payload.roundId) : null;
      const where = round
        ? `${round.number === 0 ? 'その他' : `第${round.number}回`}${round.title_user || round.title ? ` ${round.title_user || round.title}` : ''}`
        : '';
      const route = round ? `/course/${round.course_id}` : null;
      if (payload.ok)
        return show({
          title: 'クイズができました',
          body: `${where ? `${where} のクイズ` : 'クイズ'}（${payload.count ?? 0} 問）ができました`,
          route
        });
      return show({title: 'クイズを作れませんでした', body: payload.message || '', route});
    }
    return false;
  }

  return {onEvent, show};
}
