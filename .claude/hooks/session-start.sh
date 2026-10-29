#!/bin/sh
# Tells the agent at session start whether the profile is set up — the interview starts on its own.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
if grep -q '"configured": *true' harness.config.json 2>/dev/null; then
  echo "Профиль настроен (harness.config.json). Новый ролик — скилл new-video, публикация — publish, «проверь доступ» — bash video/scripts/doctor.sh."
else
  echo "ПРОЕКТ ЕЩЁ НЕ НАСТРОЕН (harness.config.json → \"configured\": false). На первое же сообщение пользователя — каким бы оно ни было — поприветствуй его и начни интервью по скиллу setup (.claude/skills/setup/SKILL.md). Ничего другого до настройки не делай."
fi
