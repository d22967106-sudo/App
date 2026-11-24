"""錢袋 v4（20×23 格）：一枚一枚疊起來的金幣、外翻袋口、繩子、袋身上金色的 $"""
P = {
    'K': (74, 44, 20), 'S': (122, 72, 30), 'B': (160, 97, 43), 'L': (194, 131, 70), 'W': (226, 178, 116),
    'R': (120, 78, 36), 'r': (214, 168, 104),
    'G': (246, 198, 52), 'H': (255, 240, 150), 'D': (196, 138, 26), 'O': (120, 80, 10),
}
W = 20
COIN = ['.OOOOO.',
        'OHHHGGO',
        'OGGGGDO',
        '.ODDDO.']
STAND = ['.OOO.',   # 立著的金幣（側面）
         'OHGDO',
         'OHGDO',
         'OHGDO',
         '.OOO.']


def build():
    coins = [
        '........OOOO........',
        '......OOHHGGOO......',
        '....OOHHGGDGHHOO....',
        '...OHGGDGHHGGDGGO...',
        '..OGHHGGDGGGHHGGDO..',
        '..ODGGDDGGDGGGDGDO..',
    ]
    assert all(len(r) == W for r in coins)
    body = [
        '..KWWLLLLLLLLLLLLSK.',
        '...KLLBBBBBBBBBBSK..',
        '....KKLBBBBBBBBSKK..',
        '.....KrrrrrrrrrrK...',
        '....KLLBBBBBBBBSKrK.',
        '...KLLBBBBBBBBBBSKrK',
        '..KLLWLBBBBGBBBBBSKR',
        '.KLLWLBBBGGGBBBBBBSK',
        '.KLLLBBBBGBBBBBBBBSK',
        'KLLLBBBBBGGGBBBBBBSK',
        'KLLBBBBBBBBGBBBBBSSK',
        'KLLBBBBBBGGGBBBBBSSK',
        'KLBBBBBBBBGBBBBBSSSK',
        '.KBBBBBBBBBBBBBBSSK.',
        '.KSBBBBBBBBBBBBSSSK.',
        '..KSSBBBBBBBBSSSSK..',
        '...KKSSSSSSSSSSKK...',
        '.....KKKKKKKKKK.....',
    ]
    out = coins + body
    assert all(len(r) == W for r in out), [len(r) for r in out]
    return out


SPRITE = build()
if __name__ == '__main__':
    print('\n'.join(SPRITE))
