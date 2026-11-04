#!/bin/bash
# Мультигерой: мультяшная версия человека для роликов, через Higgsfield CLI. Порядок и опрос — скилл `hero`.
#
# Перед запуском в takes/hero/ (в git не попадает):
#   photo.jpg       фото человека: анфас, по пояс, ровный свет
#   look.txt        внешность словами по-английски: что сохранить (причёска, борода, одежда, аксессуары)
#   style.txt       стиль рисовки словами по-английски
#   style-ref.jpg   по желанию: кадр с героем, рисовка которого нравится (только образец, в ролики не идёт)
#
#   bash video/scripts/hero.sh cost          сколько кредитов уйдёт на базу и все позы
#   bash video/scripts/hero.sh base          два варианта базы: takes/hero/base-nb.png и base-gpt.png
#   bash video/scripts/hero.sh pick nb|gpt   выбранный вариант -> video/public/hero/base.png (фон вырезан)
#   bash video/scripts/hero.sh poses         все позы из POSES по базе
#   bash video/scripts/hero.sh wow like      только названные позы
#   bash video/scripts/hero.sh sheet         сетка всех поз на светлом фоне -> video/out/hero-sheet.png
#
# Позы рисует та же модель, что и выбранную базу, на белом фоне; фон вырезает image_background_remover.
# Нужен платный тариф Higgsfield: на бесплатном ответ job_minimum_basic_plan_required.

set -euo pipefail
cd "$(dirname "$0")/../.."

SRC=takes/hero
OUT=video/public/hero
POSES="point wow phone cheer listen think like"
mkdir -p "$SRC/white" "$OUT" video/out

pose_text() {
  case "$1" in
    point)  echo "one arm raised on the left side of the image, the hand at head height, index finger clearly extended and pointing diagonally up toward the upper-left corner of the frame, as if showing something on the screen above; head and eyes turned toward it, friendly smile; the other arm relaxed down along the body." ;;
    wow)    echo "both palms on the cheeks, mouth wide open, eyebrows raised, amazed." ;;
    phone)  echo "holding a smartphone in one hand with the screen facing the viewer and pointing at it with the index finger of the other hand, smiling." ;;
    cheer)  echo "both fists raised at chest level in a victory gesture, big happy grin." ;;
    listen) echo "one hand cupped behind the ear, the other hand touching the chin, curious look." ;;
    think)  echo "one hand on the chin, the other arm folded across the body under that elbow, eyes looking up, thoughtful." ;;
    like)   echo "one hand gives a thumbs up in front of the chest, the other arm hangs down relaxed along the body; winking, confident smile." ;;
    *) return 1 ;;
  esac
}

need() { [ -f "$1" ] || { echo "нет $1 — ${2:-см. скилл hero, раздел «Опрос»}"; exit 1; }; }

# Модель и её параметры: nb — Nano Banana 2 (мультяшнее), gpt — GPT Image 2.5 (точнее по сходству).
model_of() { case "$1" in nb) echo nano_banana_flash ;; gpt) echo gpt_image_2_5 ;; *) echo "модель: nb или gpt" >&2; exit 1 ;; esac; }
args_of() { case "$1" in nb) echo "--resolution 2k" ;; gpt) echo "--quality medium" ;; esac; }

job() { # job <модель> <аргументы...> -> печатает ссылку на результат
  # Higgsfield иногда отвечает «request failed» или роняет задачу без причины, поэтому три попытки.
  local out url try
  for try in 1 2 3; do
    out=$(higgsfield generate create "$@" --wait --wait-timeout 10m --json 2>&1) || true
    url=$(printf '%s' "$out" | python3 -I -c "import json,sys; d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d; print(d.get('result_url') or '')" 2>/dev/null) || true
    [ -n "$url" ] && { echo "$url"; return 0; }
    echo "   попытка $try не удалась: $(printf '%s' "$out" | head -1)" >&2
    sleep 5
  done
  echo "   не получилось за 3 попытки" >&2
  exit 1
}

# картинка на белом фоне -> вырезка фона -> ширина 800, в OUT
cutout() { # cutout <белый png> <имя позы>
  local url
  url=$(job image_background_remover --image "$1")
  curl -sL -o "$SRC/cut.png" "$url"
  ffmpeg -v error -y -i "$SRC/cut.png" -vf scale=800:-1 "$OUT/$2.png"
  rm -f "$SRC/cut.png"
  echo "   $OUT/$2.png"
}

base_prompt() {
  local ref_rule=""
  [ -f "$SRC/style-ref.jpg" ] && ref_rule="Use the SECOND image ONLY as a drawing-style reference. Do NOT copy anything else from it: not the face, hair, clothes, accessories or pose of the person in it."
  cat <<EOF
Turn the person from the FIRST reference photo into a 2D cartoon character for short vertical videos.
Drawing style: $(cat "$SRC/style.txt")
$ref_rule
Keep a strong likeness of the person from the first photo: $(cat "$SRC/look.txt")
Pose: upper body down to the waist, facing the camera, arms crossed on the chest, confident and friendly expression.
Composition: the whole upper body fits inside the frame with generous empty space on the left, right and top; the character takes about 70 percent of the image width; the bottom edge cuts at the waist.
Plain pure white background, no text, no logo.
EOF
}

make_base() {
  need "$SRC/photo.jpg"; need "$SRC/look.txt"; need "$SRC/style.txt"
  local imgs=(--image "$SRC/photo.jpg") v url prompt
  [ -f "$SRC/style-ref.jpg" ] && imgs+=(--image "$SRC/style-ref.jpg")
  prompt=$(base_prompt)
  for v in nb gpt; do
    echo "-> база, вариант $v"
    # shellcheck disable=SC2046
    url=$(job "$(model_of $v)" --prompt "$prompt" "${imgs[@]}" --aspect_ratio 3:4 $(args_of $v))
    curl -sL -o "$SRC/base-$v.png" "$url"
    echo "   $SRC/base-$v.png"
  done
}

pick_base() {
  need "$SRC/base-$1.png" "сначала hero.sh base"
  model_of "$1" >/dev/null
  echo "$1" > "$SRC/model.txt"
  cp "$SRC/base-$1.png" "$SRC/white/base.png"
  echo "-> база: вырезаю фон"
  cutout "$SRC/white/base.png" base
}

make_pose() {
  local text v url
  text=$(pose_text "$1") || { echo "нет такой позы: $1 (есть: $POSES). Свою позу — строкой в pose_text и именем в POSES"; exit 1; }
  need "$SRC/white/base.png" "сначала hero.sh base и hero.sh pick nb|gpt"; need "$SRC/model.txt" "сначала hero.sh pick nb|gpt"
  v=$(cat "$SRC/model.txt")
  echo "-> $1"
  # shellcheck disable=SC2046
  url=$(job "$(model_of "$v")" --image "$SRC/white/base.png" --aspect_ratio 3:4 $(args_of "$v") --prompt "The same cartoon character as in the reference image: identical face, hair, clothes, accessories, outline thickness, colors and drawing style. Do not change the look, only the pose and facial expression.
New pose: $text
Anatomically correct: exactly two arms and two hands, each arm clearly attached to its shoulder, no extra arms or hands.
Upper body down to the waist, facing the camera. Composition: the whole figure including the hands fits inside the frame with empty space around it, the bottom edge cuts at the waist, same scale as the reference.
Plain pure white background, no text, no logo.")
  curl -sL -o "$SRC/white/$1.png" "$url"
  cutout "$SRC/white/$1.png" "$1"
}

cost() {
  need "$SRC/photo.jpg"
  local nb gpt bg
  nb=$(higgsfield generate cost nano_banana_flash --prompt x --image "$SRC/photo.jpg" --resolution 2k 2>&1 | tail -1)
  gpt=$(higgsfield generate cost gpt_image_2_5 --prompt x --image "$SRC/photo.jpg" --quality medium 2>&1 | tail -1)
  bg=$(higgsfield generate cost image_background_remover --image "$SRC/photo.jpg" 2>&1 | tail -1)
  echo "база: Nano Banana 2 — $nb, GPT Image 2.5 — $gpt (делаем оба варианта)"
  echo "вырезка фона — $bg за картинку"
  echo "поз в наборе: $(echo $POSES | wc -w | tr -d ' ') + база; каждая = генерация выбранной моделью + вырезка фона"
}

sheet() {
  local inputs=() f="" i=0 p
  for p in base $POSES; do
    [ -f "$OUT/$p.png" ] || continue
    inputs+=(-i "$OUT/$p.png")
    f+="color=c=0xF2F0EA:s=400x533[b$i];[$i]scale=400:533[s$i];[b$i][s$i]overlay=shortest=1:format=auto,format=rgb24[t$i];"
    i=$((i + 1))
  done
  [ "$i" -gt 0 ] || { echo "в $OUT пока нет поз"; exit 1; }
  for p in $(seq 0 $((i - 1))); do f+="[t$p]"; done
  f+="concat=n=$i:v=1:a=0,tile=4x$(((i + 3) / 4)):color=0xF2F0EA"
  ffmpeg -v error -y "${inputs[@]}" -filter_complex "$f" -frames:v 1 video/out/hero-sheet.png
  echo "video/out/hero-sheet.png"
}

case "${1:-}" in
  cost)  cost ;;
  base)  make_base ;;
  pick)  [ $# -ge 2 ] || { echo "какой вариант: nb или gpt"; exit 1; }; pick_base "$2" ;;
  poses) for p in $POSES; do make_pose "$p"; done ;;
  sheet) sheet ;;
  "")    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *)     for p in "$@"; do make_pose "$p"; done ;;
esac
