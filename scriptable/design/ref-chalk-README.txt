捷徑圖示產生器（黑板粉筆像素風）

檔案：
  make.py / v2.py  像素圖案定義（chalk.py 會讀取，不要刪）
  wall.py          產生示意圖用的桌布 wallpaper.png
  chalk.py         主程式：輸出 out/小工具背景.png、out/按鈕/、out/主畫面圖示/
  fonts/cy.ttf     辰宇落雁體（免費開源字型）

新增捷徑的步驟：
  1. 在 v2.py 加入新圖案（16x16 字元圖），並加進 icons 清單（名稱、標籤、圖案、顏色）
  2. 在 chalk.py 的 TILE 加入新按鈕的框線顏色（名稱以 off 結尾者自動用淡灰色）
  3. 用新標籤文字重新做字型子集（字型原檔的 hinting 會讓 Pillow 出錯）：
     pyftsubset fonts/cy.ttf --text="燈開關鬧鐘冷氣投影機記一筆＋新字" --no-hinting --output-file=fonts/cy2.ttf
  4. python3 wall.py && python3 chalk.py
需要：Python 3、pip install pillow fonttools

1600x1684 四邊木框版（大型小工具比例）：python3 big.py（輸出到 out1600/）
