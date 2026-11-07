/**
 * 保存した ID・パスワードでの自動ログインの結果を数える（v0.19.2）。
 *
 * 「パスワードが違う」と判断したら、すぐには止めず、続けて 2 回そう判断したときだけ自動ログインを止める。
 * 画面の読み込みが遅い・お知らせの文に「失敗」とあるなどで、1 回だけ見誤ることがあるため。
 * 2 回で止めるのは、何度も送って大学のアカウントをロックさせないため。
 * 止めたときは理由と時刻を設定に残し、設定の画面に出す（入れ直すと消える）。
 */

/** 止めるまでに続けて「違う」と判断する回数 */
export const BAD_LIMIT = 2;

const countKey = (cid) => `login.badCount.${cid}`;
const stoppedKey = (cid) => `login.stopped.${cid}`;

/**
 * 自動ログインの結果を記録する。error がなければ成功。
 * 戻りは {stopped}（この回で自動ログインを止めたか）
 */
export function noteAutoLogin(repo, cid, error, now = new Date()) {
  if (!error) {
    if (repo.getSetting(countKey(cid), null) !== null) repo.removeSetting(countKey(cid));
    return {stopped: false};
  }
  if (error.code !== 'login-bad-credentials') return {stopped: false};
  const count = Number(repo.getSetting(countKey(cid), 0)) + 1;
  if (count < BAD_LIMIT) {
    repo.setSetting(countKey(cid), count);
    return {stopped: false};
  }
  repo.removeSetting(countKey(cid));
  repo.setSetting(stoppedKey(cid), {at: now.toISOString(), message: String(error.message ?? '').slice(0, 300)});
  repo.updateConnection(cid, {save_password: 0});
  return {stopped: true};
}

/** 止めた理由（なければ null） */
export function autoLoginStopped(repo, cid) {
  return repo.getSetting(stoppedKey(cid), null);
}

/** ID・パスワードを入れ直した・自動ログインをやめたときに、数えた回数と止めた理由を消す */
export function clearAutoLoginStrikes(repo, cid) {
  repo.removeSetting(countKey(cid));
  repo.removeSetting(stoppedKey(cid));
}
