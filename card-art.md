# Card art design guide

How card art in Entity Duel is made, and the image-generator prompt for each card. Keep new art consistent
with the pieces already in the game (Kunoichi, Pyre Adept, Soothe, the Wildblitz beasts).

Technical wiring (file sizes, `art:` on the card, board cropping) is in `CLAUDE.md` under "Card art". The world
and card flavour are in `LORE.md`.

## House style

Bold comic-book ink illustration: thick black linework, flat cel-shading with hatching, dramatic lighting, a
painterly textured background. One clear subject, a readable silhouette, an expressive face where there is one.

**Shared style line.** Paste this at the start of every prompt, then add the scene:

> Bold comic-book ink illustration, thick black linework, flat cel-shaded colour with hatching, dramatic lighting, painterly textured background. Square composition, subject centred, no frame, no border, no caption, no text.

### Composition rules

- **Ask for square (1:1).** The art is shown in a landscape 4:3 window in the hover preview, cropped to a tall
  portrait on board cards (`object-fit: cover`, centre), and fills the whole codex detail modal. Keep the main subject
  and the face inside the middle two-thirds so every crop still works.
- **Wide scenes are fine for spells** (Pyroblast, Overgrowth), but the board crop shows only the centre, so put the
  hero element there.
- **No frame, border, caption or text** in the image. The card draws its own.
- **Faces readable at small size.** The board card is about 110 px wide; avoid tiny faces or busy detail at the edges.
- **Family-friendly.** Undead and horror are comic, not gory.

### Palette by tradition

| Tradition | Look |
|---|---|
| Wildwood / Wildblitz (beasts) | forest greens, mossy browns, mist, warm gold accents |
| Pyre / Emberwood (fire) | molten orange, yellow-white core, crimson, charcoal |
| Stonewall (defence) | slate, steel grey, pale blue, dusty tan, warm gold barriers |
| Grave Tide (undead) | sickly grey-green, bruised purple, pale bone, mud brown |
| Iron Blossom Clans | dark iron, crimson, white, indigo, cherry-blossom pink |
| Skyward (storm, air) | storm blue-black, pale lightning, cloud white |

### Delivery checklist (what to hand back)

1. The image, square if possible, any size (the game resizes it).
2. Which card it is for (or send in the order of the prompts below).
3. Then it is resized to a WebP of about 420-520 px wide (target under 45 KB), wired with `art:` in
   `src/cards/cards.ts`, the old PNG deleted, and `CLAUDE.md` updated.

---

## Done (new art in the game)

Kunoichi, Swift Lancer, Pyre Adept, Grave Necromancer, Insight, Ember Sprite, Stoneback Cub, Sky Talon, Thornwood
Brute, Granite Sentinel, Storm Drake, Dread Maw, Soothe, Pyroblast, Ancient Treant, Call Wolves, Overgrowth, Bulwark,
Zombie token, Shambling Ghoul, Plague Priest, Rotting Hulk, Carrion Colossus, Raise Horde, Wolf token, Ronin Blade,
Kensei Duelist, Iron Shogun, Iaijutsu Strike, Warding Stance, Scorch.

## To do (still on the original art)

Still original and without a prompt yet: Ashigaru, Aether Well, Cinderbolt, Grasp from the Grave, Shuriken Volley, Soul Siphon,
Take Counter, Topple, Wild Growth, Withering Touch.

---

## Prompts: Grave Tide (undead)

**Zombie token** (1/1: "It rises again, and again, and again.")
Drawn as a dead Clan footman (Ashigaru). There is also a living Ashigaru card, which is separate.

> A dead Ashigaru footman clawing up out of churned grave-soil, torn lacquered foot-soldier armour and a cracked straw jingasa hat, grey-green skin, glowing pale eyes, one hand still gripping a rusted spear. More hands push up from the earth behind him. A foggy battlefield at dusk with broken banners. Palette: sickly grey-green, mud brown, dull rust red.

**Shambling Ghoul** (2/2: "It shambles ever forward, and never tires.")

> A hunched, gaunt ghoul in rags lurching straight toward the viewer, arms hanging low, long dragging claws, hollow glowing eyes, jaw hanging open. Behind it a trail of footprints through a misty burial ground with leaning stone markers. Relentless, tireless, not frantic. Palette: cold grey, bruised green, pale bone.

**Plague Priest** (1/2, Rot: opponent discards at random, and loses 1 life whenever you cast a sorcery; "Every incantation spreads the rot a little further.")
Lore: Mother Vess prepares the living to rise whole; she is patient, not a monster.

> Mother Vess, a calm hooded priestess in tattered green-black vestments, holding a censer that trails thick green-grey smoke. Tiny spores and drifting pages float around her. Behind her, an infirmary full of shrouded cots and flickering candles. Her face is serene and patient, not menacing. Palette: sickly green, ash grey, candle-gold accents.

**Rotting Hulk** (4/5, last breath: raise a Zombie; "A mound of grave-flesh stitched with spite.")

> A huge bloated brute stitched together from grave-flesh, thick ragged sutures and rusted hooks across its body, one swollen arm dragging a broken iron weight. A small zombie crawls out of a rip in its side. It stands in a gloomy crypt yard under a sickly moon. Palette: putrid green, bruised purple, dirty bone.

**Carrion Colossus** (7/6, lifelink; "The tide of the dead, made flesh at last.")
Lore: not raised by anyone; enough hollowed dead lie together until they "agree".

> A towering giant made of countless hollowed corpses fused into one standing mass, faces and limbs pressed into its shoulders and chest, a pale glow of stolen life gathering in its chest cavity. It rises over a field of fallen soldiers, its shadow covering a tiny figure at its feet (Sael, a necromancer). Comic horror, not gory. Palette: ash grey, necrotic green, pale glow.

**Raise Horde** (sorcery, two Zombies, flashback; "The soil remembers every soldier it has swallowed.")

> A battlefield of old graves bursting open as a crowd of ragged zombie soldiers claw up out of the earth, armour fragments and broken banners in their hands. In the foreground a necromancer's glowing green hand, palm down, calls them up. A sea of rising hands under an overcast sky. Palette: grave green, mud brown, grey sky.

## Prompts: Wild (Greyward)

**Wolf token** (1/1: "The pack answers the call.")

> A single lean grey wolf mid-stride, head low and eyes locked on the viewer, fur bristling, breath misting in cold air, a wooded ridge behind it at dawn. Loyal and focused, not snarling. Palette: grey, pale blue, warm dawn light.

## Prompts: Iron Blossom Clans

**Ronin Blade** (2/2, haste; "A masterless sword, restless even in the fray.")
Lore: Juro, the Masterless, who broke from the banner at the Kettle.

> Juro, a lean masterless swordsman in a worn dark robe, straw hat tilted back, one hand on his katana mid-draw, a torn clan banner at his hip. He is mid-sprint down a dusty road, with a few cherry petals blowing past. Restless, unsettled expression. Palette: faded indigo, dust tan, petal pink.

**Kensei Duelist** (3/2, haste, first strike; "One breath, one cut. There is no second.")
Lore: Hana of the Single Breath, who never strikes twice at the same opponent.

> Hana of the Single Breath, a calm female swordmaster in a clean white and crimson kimono, katana sheathed at her hip with her hand on the hilt, the instant just before a draw. Behind her a silver arc of cut light and a falling blossom sliced in two. Her eyes are closed. Palette: white, crimson, steel silver.

**Iron Shogun** (5/4, first strike; "Where his banner rides, the line follows.")
Lore: Tadeo Kurosa, the only Shogun in nine generations to ride at the front.

> Tadeo Kurosa, a battle-scarred Shogun in dark iron armour with a crested horned helm, charging at the front of a battle line on horseback, a huge iron-blossom banner streaming behind him, sword raised. Ashigaru spears surge behind. Dust and sparks. Palette: dark iron, crimson, warm gold.

**Iaijutsu Strike** (instant, +1/+1; "The blade is sheathed before you see it move.")

> A swordsman in a crouch, blade just back in its sheath, a thin white cut-line of light across the frame and a ghostly afterimage of the draw behind him. Calm face, one eye open. A dark empty courtyard with falling petals frozen mid-air. Palette: black, white, thin crimson accents.

**Warding Stance** (instant, +0/+3; "Brace. Breathe. Let the blow break upon you.")

> A veteran warrior in a rooted wide stance, forearms crossed in front, a translucent pale-blue ripple of force around him as an arrow volley and blades shatter against it. Eyes closed, steady breath. A mountain pass with dust blowing. Palette: slate, pale blue, dusty tan.

## Prompts: Pyre

**Scorch** (sorcery, 5 damage; "More of the warmth than any one person should hold.")
Kept distinct from Pyroblast (a vortex from one palm): this is a sweeping wall of fire.

> A robed Pyre monk with both arms thrown wide as a rolling wall of white-orange flame sweeps across a stone courtyard toward the viewer, the ground glassed and cracking where it passes, heat-haze warping the air. His sleeves burn away into ribbons of light. A line of fire reaching the horizon at sunset. Palette: white-hot yellow, deep orange, charcoal.

---

## Skill cut-in art (the band that slams across the screen when a skill fires)

Separate from the card art. When a skill activates, a slanted band cuts across the middle of the screen with the caster's
face on it (`CutIn.tsx`, `public/ui/<kind>.webp`). It is a **wide close-up of the face**, not a full-body pose.

Specs:

- **Wide, about 2.4:1 to 2.7:1** (for example 1000x400 or 1090x400). The game crops to cover, so keep the face centred.
- **Face and eyes are the point.** An extreme close-up from the nose up to the brow (or the whole face), eyes in the upper
  third, intense and readable. Fills most of the frame.
- **Centre the face; keep the left third calm.** The game already shifts the art to the right of the screen and fades
  its left edge into the band colour, so anything detailed on the left third is lost. Use dark or flame haze there.
- **Simple, dark or single-colour background** so the game's speed lines, flash and colour edge read on top. No frame,
  border, caption or text.
- Delivered as WebP (target under 60 KB). Wired in `CutIn.tsx` (`ART`), `fxTiming.ts` (the kind) and a colour block in
  `index.css`; today's: `blitz` (Kunoichi, battle cry), `grave` (Grave Necromancer, grin), `pyre` (Pyre Adept, burning
  glare), `whip` (Thornwood Brute, snarl; white background, so it is multiplied over a green band).

**Bulwark: Flash (Castellan Marrek snaps the line shut in the instant it is needed)**
Wired (`flash-guard.webp`, 1009x401): the `flash` cut-in plays only when Bulwark is cast at instant speed (the attack or block
step), not when it is cast in your main phase. Lore: Castellan
Marrek, who has held the middle pass for thirty-one years: "we are not here to win, we are here to still be here." Match
the card art (dented steel plate, round shield, golden barrier). Same shared style line with "Wide 2.5:1 composition".

> Wide 2.5:1 extreme close-up of Castellan Marrek's face, a grim veteran with a weathered, scarred face and a short grey beard, wearing a dented steel helmet with a nose guard, eyes hard and unblinking, jaw set. A large round steel shield edge cuts across the lower foreground, and a translucent golden dome of light flashes outward around him, blasting dust and small stones past the frame in streaks. Behind him a dim stone mountain pass. A sudden bright flash of gold light at the shield's rim. Palette: steel grey, warm gold, dusty tan, deep blue-grey shadow. Keep the left third dark and calm.

**Pyre Adept: spell trigger (every sorcery she casts burns the opponent)** (delivered as `pyre-glare.webp`, 1014x402)
Uses the shared style line, with "Wide 2.5:1 composition" in place of "Square composition".

> Wide 2.5:1 extreme close-up of Sorae's face, a young Pyre adept with messy dark hair, brows low and furious, teeth bared in a shout, her eyes blazing bright amber-white as if lit from inside. Heat-haze and flame licks frame the sides of her face, a swirl of fire passing across the foreground, embers streaking past. One burning palm just visible at the edge of the frame. Dark smoky background so the flames glow. Palette: black-brown smoke, hot orange and yellow flame, ember red, with a bright amber glint in the eyes.

**Kunoichi: Beast Blitz (Kasei's whistle calls the pack; her beasts get +1/+1)** (delivered as `blitz-face.webp`, 1015x405)
Lore: Kasei, the Whistling Girl, raised by the animals that fled the hollowing at Red Shallows. She does not command
beasts, she reminds them of something. Her whistle is a fragment of the Sleeper's dream. Match the card art: light brown
windswept hair, cream vest over a dark high collar, steel shoulder guard. Today's cut-in is `blitz-face.webp`
(battle cry). Same shared style line with "Wide 2.5:1 composition". The Beast Blitz band is gold and red, so keep the
background warm and dark; the beasts are shown only as faint shapes.

> Wide 2.5:1 extreme close-up of Kasei's face, a fierce young kunoichi with windswept light brown hair, a thin scar across one cheek, brows drawn low and eyes narrowed and blazing, mouth open mid-battle-cry as she calls her beasts. Her hair whips back in a strong wind. Behind her in dark golden haze, faint translucent silhouettes of a wolf's head and a hawk's wings surge forward as if answering her cry, with streaks of gold wind and a few flying leaves. The edge of a steel shoulder guard catches a flash of light. Palette: warm gold, deep red, charcoal brown, with a bright catchlight in her eyes. Keep the left third dark and calm.

---

## Prompts already used (reference, for matching the look)

**Kunoichi** (2/1, Beast Blitz; "One whistle, and the wild answers.") (delivered, 3:4 portrait)
Lore: Kasei, the Whistling Girl. Describes today's art (a full-body pose on a mountain ledge) and matches the Beast Blitz
cut-in face (light brown windswept hair, a thin scar across one cheek, steel shoulder guard). The current card art is a
3:4 portrait; ask for square so it crops well everywhere.

> Kasei, the Whistling Girl, a fierce young kunoichi with long windswept light brown hair and a thin scar across one cheek, in a cream vest over a dark high-collared shirt, a steel shoulder guard, bandaged forearms and shins, dark trousers and sandals. She crouches low on a rocky mountain ledge, a short curved blade held back in one hand, the other hand open at her side as if she has just whistled. Her eyes are narrowed and sharp. Faint translucent shapes of a wolf and a hawk drift in the clouds behind her, answering her call. Wind whips her hair and bits of grass. Background: a high mountain pass with drifting cloud and a bright, partly cloudy sky. Palette: warm gold and cream, steel grey, deep green-grey rock, soft sky blue.

**Pyre Adept** (1/2, prowess; whenever you cast a sorcery, 1 damage to the opponent; "Every spell feeds the fire within.")
Lore: Adept Sorae, the Pyre's most promising student, who feels the record "thinning" every time she casts. The art in
the game today shows a young dark-haired adept in a wide stance with a fire swirling in each hand; this prompt
describes that same pose. Keep her distinct from the Pyroblast mage (spiky red-orange hair) and the Scorch monk.

> Sorae, a young Pyre adept with short dark hair, in a dark maroon sleeveless gi with a black sash, black trousers, leather forearm guards and wrapped shins with sandals. She is in a low, wide combat stance with a ball of swirling fire in each open hand, flames trailing in arcs behind her, embers flying. Her expression is intense and focused, brows low. A cracked rocky ground with small flames licking at the stones and a pale, hazy background. Palette: deep maroon, black, bright orange and yellow flame, warm cream haze.

**Soothe** (instant, gain 6 life; "Rest now. The walls will hold.")
Lore: Sister Anwe of the Quiet House heals with water, time and a voice, not with the Wells.

> Sister Anwe, a calm Stonewall healer in a plain slate-grey and cream monastic robe with a hood, kneeling beside a wounded soldier on a quiet stone courtyard at dusk. She pours a thin ribbon of clear water from a clay bowl over his bandaged arm, and the water glows soft teal and drifts upward as tiny motes. Her expression is gentle and steady. Behind her, a fortress wall and a quiet stone house with lantern light. Palette: slate blue, warm cream, teal glow, with deep shadows.

**Pyroblast** (sorcery, 6 damage; "The sky itself catches fire.")

> A young fire mage with spiky red-orange hair in a dark red sleeveless gi with a black sash, in a wide braced stance, thrusting one palm forward. A huge swirling vortex of flame spirals from his hand toward the viewer, embers and heat-streaks flying. His face is fierce, mouth open in a shout. Background: a scorched hillside under a sky turning orange-red, as if the clouds themselves are burning. Palette: molten orange, yellow-white core, deep crimson and charcoal.

**Ancient Treant** (7/7, trample; "Older than the kingdoms that fear it.")

> A colossal ancient tree-giant striding through a misty old forest, bark body like gnarled armour plates, moss and lichen on its shoulders, huge root-fingers spread wide, glowing green eyes in a stern, furious face. Roots tear up the forest floor as it advances. Tiny broken stone ruins half-swallowed by roots in the background hint that it is older than any kingdom. Palette: deep forest greens, mossy browns, pale mist, cold green glow.

**Call Wolves** (sorcery, two Wolves; "One howl, and the wild comes running.")

> Two grey wolves sprinting out of a misty dark forest straight toward the viewer, fur bristling, eyes sharp. In the foreground an old summoning scroll lies unrolled on the ground, its ink glowing with golden sparks and white smoke curling up, as if the scroll just called them. Pale moonlit mist between the trees. Palette: cool grey and blue-green forest, warm gold glow from the scroll, white smoke.

**Overgrowth** (sorcery, put up to two lands onto the battlefield; "The forest rushes to meet you.")
If the generator gives only vines, add "two small stone shrines rising out of the ground" so it reads as lands.

> A dark silhouetted figure standing in the centre of a spiralling vortex of thick thorned vines and roots that burst up out of the ground in every direction, whipping leaves into the air. In the foreground two small glowing stone shrines or standing stones are lifted up out of the earth by the roots. The whole scene is a surge of wild growth swirling around the figure. Palette: rich greens, golden-green light from the centre, earthy brown roots, dark vignette.

**Bulwark** (1/6, defender, reach, flash; "The line holds here.")
Lore: Castellan Marrek, who has held the middle pass for thirty-one years.

> Castellan Marrek, a heavily armoured veteran soldier in dented steel plate, planted in a wide defensive crouch behind a large round steel shield, a long spear angled up and back. Around him a translucent golden dome of light holds back a swirl of dust and blown debris. His face is grim and unmoved. Background: a narrow stone mountain pass with a pale hazy sky. Palette: steel grey, warm gold barrier glow, dusty tan and blue-grey.
