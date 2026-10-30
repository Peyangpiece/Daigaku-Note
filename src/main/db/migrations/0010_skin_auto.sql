-- 0010：授業のテンプレートが、自動で付いたもの（新しい授業に順に割り当てた）か、本人が選んだものか（SPEC-KISEKAE §4.4）。
-- 自動で付いたものは、全体のテンプレートを当てたときにそれに合わせる（本人が選んだものは残す）。
-- 今ある授業は、順の割り当てに使うはじめからあるテンプレート（shared/skin.js の ROTATION）が付いていれば自動とみなす。
-- 作った順では見分けない（授業を消したり、別の学期へ移したりすると順がずれるため）。本人が選んでいた場合も、
-- 全体に当てたときの「元に戻す」で戻せる
ALTER TABLE course ADD COLUMN skin_auto INTEGER NOT NULL DEFAULT 0;
UPDATE course SET skin_auto = 1
WHERE skin_template_id IN (
  'builtin-lemon', 'builtin-mint', 'builtin-sakura', 'builtin-sky', 'builtin-kraft', 'builtin-navy', 'builtin-lavender'
);
