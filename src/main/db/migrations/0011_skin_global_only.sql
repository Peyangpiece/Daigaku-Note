-- 0011：着せ替えのテンプレートはアプリ全体で 1 つにする（SPEC-KISEKAE §4.1）。
-- 授業ごとのテンプレート・自動で付けた印・シールの重ね方は使わない（列は残すが、すべて空・既定に戻す）。
-- 授業ごとに選んでいたテンプレートは消さない（マイノートに残り、全体として選べる）
UPDATE course SET skin_template_id = NULL, skin_auto = 0, sticker_mode = 'global';
