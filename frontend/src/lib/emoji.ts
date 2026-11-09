/** Emoji for the picker, reactions and :kürzel:. First name after the emoji is the shortcode. */
const RAW: [string, string][] = [
  [
    'Smileys',
    `😀 grinning grinsen lachen|😃 smiley freude|😄 smile lächeln|😁 grin strahlen|😆 laughing lachen|😅 sweat_smile puh|🤣 rofl rofl boden|😂 joy tränen lachen|🙂 slight_smile lächeln|🙃 upside_down kopfüber|😉 wink zwinkern|😊 blush freundlich|😇 innocent engel|🥰 smiling_hearts verliebt|😍 heart_eyes herzaugen|🤩 star_struck staunen|😘 kiss kuss|😋 yum lecker|😛 tongue zunge|😜 stuck_out_tongue_winking frech|🤪 zany verrückt|🤨 raised_eyebrow skeptisch|🧐 monocle prüfen|🤓 nerd streber|😎 sunglasses cool|🥳 partying party feiern|😏 smirk grinsen|😒 unamused genervt|🙄 eye_roll augenrollen|😬 grimacing zähne|😌 relieved erleichtert|😔 pensive nachdenklich|😴 sleeping schlafen|🤤 drooling sabbern|😷 mask maske krank|🤒 thermometer fieber|🤢 nauseated übel|🤮 vomit kotzen|🥵 hot heiß|🥶 cold kalt|😵 dizzy schwindlig|🤯 exploding_head kopf|🤠 cowboy cowboy|😕 confused verwirrt|😟 worried besorgt|😮 open_mouth staunen|😲 astonished überrascht|😳 flushed rot|🥺 pleading bitte|😢 cry weinen|😭 sob heulen|😱 scream schrei|😤 triumph schnauben|😡 rage wütend|😠 angry sauer|🤬 cursing fluchen|😈 smiling_imp teufel|💀 skull schädel|💩 poop kacke|🤡 clown clown|👻 ghost geist|👽 alien alien|🤖 robot roboter|🤔 thinking denken|🤫 shushing psst|🤭 hand_over_mouth kichern|🤗 hugging umarmen|🥲 smiling_tear gerührt|😶 no_mouth sprachlos|😐 neutral neutral|😑 expressionless ausdruckslos`,
  ],
  [
    'Gesten',
    `👍 thumbsup daumen hoch ja|👎 thumbsdown daumen runter nein|👌 ok_hand okay|✌️ v victory peace|🤞 crossed_fingers daumen drücken|🤟 love_you_gesture|🤘 metal rock|🤙 call_me anruf|👋 wave winken hallo|🙌 raised_hands hurra|👏 clap klatschen|🙏 pray danke bitte|🤝 handshake handschlag|💪 muscle stark|✍️ writing_hand schreiben|👀 eyes augen schauen|🧠 brain gehirn|🫡 salute salut|🫶 heart_hands herzhände|🤌 pinched_fingers|👉 point_right rechts|👈 point_left links|👆 point_up oben|👇 point_down unten`,
  ],
  [
    'Herzen',
    `❤️ heart herz liebe|🧡 orange_heart|💛 yellow_heart|💚 green_heart|💙 blue_heart|💜 purple_heart|🖤 black_heart|🤍 white_heart|💔 broken_heart gebrochen|💖 sparkling_heart|💘 cupid amor|💯 100 hundert|💥 boom knall|💫 dizzy_star|💬 speech sprechblase|💤 zzz schlaf`,
  ],
  [
    'Natur',
    `🐶 dog hund|🐱 cat katze|🐭 mouse maus|🐰 rabbit hase|🦊 fox fuchs|🐻 bear bär|🐼 panda panda|🐸 frog frosch|🐵 monkey affe|🦄 unicorn einhorn|🐝 bee biene|🦋 butterfly schmetterling|🌸 cherry_blossom blüte|🌹 rose rose|🌻 sunflower sonnenblume|🌲 tree baum|🍀 four_leaf_clover glück|🌞 sun_face sonne|🌙 moon mond|⭐ star stern|✨ sparkles funkeln|⚡ zap blitz|🔥 fire feuer|🌈 rainbow regenbogen|☀️ sunny sonnig|☔ umbrella regen|❄️ snowflake schnee|🌊 wave_water welle`,
  ],
  [
    'Essen',
    `☕ coffee kaffee|🍺 beer bier|🍻 beers prost|🍷 wine wein|🥂 clinking_glasses anstoßen|🍕 pizza pizza|🍔 burger burger|🍟 fries pommes|🌭 hotdog hotdog|🌮 taco taco|🍣 sushi sushi|🍝 spaghetti nudeln|🍰 cake kuchen|🎂 birthday geburtstag|🍪 cookie keks|🍫 chocolate schokolade|🍿 popcorn popcorn|🍎 apple apfel|🍌 banana banane|🍓 strawberry erdbeere`,
  ],
  [
    'Dinge',
    `🎉 tada party|🎊 confetti konfetti|🎁 gift geschenk|🏆 trophy pokal|🥇 first_place gold|👑 crown krone|💎 gem diamant|💰 moneybag geld|🚀 rocket rakete|✈️ airplane flugzeug|🚗 car auto|🏠 house haus|🎮 video_game spiel|🕹️ joystick|🎲 game_die würfel|🎯 dart ziel|🧩 puzzle puzzle|⚽ soccer fußball|🏀 basketball|🎵 musical_note musik|🎧 headphones kopfhörer|🎤 microphone|📷 camera kamera|💻 computer laptop|📱 iphone handy|⌨️ keyboard tastatur|🔧 wrench werkzeug|🔨 hammer|🛡️ shield schild|⚔️ swords schwerter|🔒 lock schloss|🔑 key schlüssel|📌 pushpin pin|📎 paperclip|📅 calendar kalender|⏰ alarm wecker|💡 bulb idee|✅ white_check_mark erledigt ja|❌ x nein falsch|❓ question frage|❗ exclamation ausrufezeichen|⚠️ warning warnung|🆗 ok ok|🇦🇹 flag_at österreich|🇩🇪 flag_de deutschland`,
  ],
];

export interface EmojiEntry {
  emoji: string;
  /** Shortcode without colons, e.g. "thumbsup". */
  code: string;
  /** Lower-case search words (English and German). */
  words: string;
}

export const EMOJI_GROUPS: { label: string; emojis: EmojiEntry[] }[] = RAW.map(([label, list]) => ({
  label,
  emojis: list.split('|').map((item) => {
    const [emoji = '', code = '', ...rest] = item.trim().split(' ');
    return { emoji, code, words: [code, ...rest].join(' ').toLowerCase() };
  }),
}));

export const ALL_EMOJI: EmojiEntry[] = EMOJI_GROUPS.flatMap((g) => g.emojis);

const BY_CODE = new Map(ALL_EMOJI.map((e) => [e.code, e.emoji]));

/** The six offered directly under a message. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

/** Best matches for a typed word: shortcode starts first, then anywhere in the search words. */
export function searchEmoji(query: string, limit = 8): EmojiEntry[] {
  const q = query.toLowerCase();
  const starts = ALL_EMOJI.filter((e) => e.code.startsWith(q));
  const rest = ALL_EMOJI.filter((e) => !e.code.startsWith(q) && e.words.includes(q));
  return [...starts, ...rest].slice(0, limit);
}

export function emojiForCode(code: string): string | null {
  return BY_CODE.get(code.toLowerCase()) ?? null;
}

/** Turns :kürzel: into emoji, leaving code and unknown names alone. */
export function replaceShortcodes(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/:([a-z0-9_+-]{2,32}):/gi, (all, code: string) => emojiForCode(code) ?? all),
    )
    .join('');
}
