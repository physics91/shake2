// The account's items as the client tests them (hasItem 0x45f140): slot k owned, or a pack that
// holds it. The names are the unreferenced item table's (0x469c6c) where a gate matches one (I).
/** 레드카드: the host's kick icon on a room slot. */
export const ITEM_KICK = 2;
/** 마스크: the mask icon, which keeps a player from chatting. */
export const ITEM_MASK = 3;
/** 자물쇠: a secret room. */
export const ITEM_LOCK = 5;
/** 이쁜이: the room's line flashes in the list. */
export const ITEM_HIGHLIGHT = 6;
/** 베팅방. */
export const ITEM_BET = 7;
/** 귓속말: the whisper icon. */
export const ITEM_WHISPER = 8;
/** 닉네임: the my-info window's nickname popup. */
export const ITEM_NICK = 9;
/** Grants 3, 6 and 7. */
export const ITEM_PACK_A = 10;
/** Grants 1, 4, 5 and 9. */
export const ITEM_PACK_B = 11;
/** 플래티넘팩: grants every item. */
export const ITEM_ALL = 12;
/** 캐릭터꾸미기: the my-info window's colour popup. */
export const ITEM_COLOUR = 20;

export function hasItem(items: readonly number[], k: number): boolean {
  if (items.includes(k) || items.includes(ITEM_ALL)) return true;
  if (items.includes(ITEM_PACK_A) && [3, 6, 7].includes(k)) return true;
  return items.includes(ITEM_PACK_B) && [1, 4, 5, 9].includes(k);
}
