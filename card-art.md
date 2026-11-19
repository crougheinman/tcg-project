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
Kensei Duelist, Iron Shogun, Iaijutsu Strike, Warding Stance, Scorch, Ashigaru, Cinderbolt, Shuriken Volley, Topple, Take Counter, Grasp from the Grave, Soul Siphon, Wild Growth, Aether Well, Withering Touch.

## To do (still on the original art)

Nothing: every card has new art.

---

## Prompts: Grave Tide (undead)

**Grave Necromancer** (1/3; Grave Call: return your most recently fallen creature to hand; whenever you cast a spell, raise a 1/1 Zombie; "The dead make patient students.")
Lore: Sael, First of the Read Terms, Sorae's brother, trained at the Pyre beside her. He decided the record was correct and
stopped drawing on the living account. Not a fanatic, just exact. He keeps a ledger. Match his look in the Soul Siphon art
(hooded black-green robe, paper ritual tags, bone-claw necklace, bandaged hand, satchel, skull staff with green flame). The
art in the game is this redo (delivered).

> Sael, the Grave Necromancer, a gaunt pale young man under a deep black-green hood, faintly glowing green eyes, a calm thin smile. Torn dark robes with paper ritual tags and a bone-claw necklace, a bandaged left hand holding an open ledger, a leather satchel at his hip, and a gnarled staff topped with a skull wreathed in pale green flame in his right hand. He beckons with two fingers; behind him a translucent pale-green soldier in old armour steps up out of an open grave, called back by name, while a small ragged zombie claws out of the soil by his boot. A foggy graveyard at dusk with leaning headstones and a broken banner. Palette: black-green, ghostly pale green, bone white, muted grey sky.

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

**Ashigaru** (2/1; "A footman of the clan — spear steady, honor steadier.")
The living counterpart of the Zombie token (a dead Ashigaru): same lacquered armour and straw hat, so the pair reads as
"before and after". Keep him a plain rank-and-file soldier, steady rather than heroic.

> An Ashigaru, a young clan foot soldier in red-brown lacquered armour over a dark tunic, a wide conical straw jingasa hat, standing in a braced forward stance with a long spear levelled at the viewer, his jaw set and eyes steady. A small clan crest on his chest plate. Behind him a few more spears and banners of the Iron Blossom clan in a dusty early-morning field, with a few cherry petals drifting past. Palette: rust red, dark iron, straw yellow, dusty tan, petal pink accents.

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

**Cinderbolt** (sorcery, 3 damage, cost 1; "A handful of the old warmth, spent all at once.")
Kept small and fast next to Pyroblast (a vortex) and Scorch (a wall): one tight bolt.

> A Pyre adept's cupped hands thrown forward in the foreground, just releasing a single tight white-orange bolt of fire the size of a fist, a thin trail of sparks and heat-ripple streaking across a dusky stone courtyard toward a distant target. Her sleeves flutter back, her face half-lit by the glow, calm and exact. The flame is compact and bright, not a blaze. Palette: white-hot core, orange, deep blue-black dusk, charcoal.

## Prompts: Iron Blossom Clans (spells)

**Shuriken Volley** (instant, 3 damage; "Steel falls like rain, and just as quietly.")
Uses Hana of the Single Breath (the Kensei Duelist card): white and crimson kimono, black hair in a bun with red pins.

> Hana of the Single Breath, the Kensei Duelist, in her white and crimson kimono with her black hair in a bun held by red pins, mid-throw with one arm swept across her body, a fan of a dozen steel shuriken spinning outward from her hand toward the viewer in a wide arc, each with a thin silver motion trail. Her eyes are calm and focused. A dark tiled courtyard at dusk behind her, a few cherry petals sliced in two by the blades. Palette: white, crimson, steel silver, deep blue-grey dusk.

## Prompts: Stonewall

**Take Counter** (instant, cast only while blocking, destroy a tapped creature; "Strike when its guard is down.")
Lore: the Counter-Stroke, the trained patience to stand still while a thing commits, then kill it where it cannot withdraw.

> A Stonewall defender in grey-blue plain armour standing perfectly still as a huge armoured attacker lunges at him with a raised axe, overextended and off balance. At the last instant the defender's short blade flashes in one clean upward counter-stroke, a bright silver slash across the frame. A narrow stone gateway behind them with dust kicked up. Calm face, steady stance. Palette: slate grey, steel silver, dusty tan, a single warm gold glint on the blade.

**Topple** (instant, tap all opposing creatures with toughness 2 or less; "The small ones never see the ground rise to meet them.")

> A cracked stone road buckling upward in a sudden wave, throwing a swarm of small, quick enemy raiders (light-armoured, with short blades) off their feet mid-charge, arms flailing, weapons flying. In the background a lone Stonewall guard stands unmoved, one palm pressed to the ground. Dust, stone chips and a low heavy shockwave ring. Palette: slate grey, dusty tan, pale blue, deep brown shadow.

## Prompts: Grave Tide (spells)

**Grasp from the Grave** (instant, cast only while blocking, destroy a tapped creature; "Cold hands close around its ankles.")
Different from Raise Horde (a crowd rising): this is a few pale hands taking one overcommitted attacker.

> A heavily armoured attacker mid-stride across a misty graveyard path, suddenly yanked down as pale, grey-green skeletal hands burst from the soil and clamp around his ankles and shins, his face lit by shock, his weapon falling from his hand. Cracked grave-soil, a leaning headstone, and a faint cold green glow from the ground. Palette: sickly green, bone grey, cold black-blue, mud brown.

**Soul Siphon** (instant, gain 5 life; "Their last breath becomes your first.")

> A hooded Grave Tide necromancer standing over a fallen soldier at dusk, one open palm raised as ghostly pale-green wisps of soul stream out of the dying man's chest and mouth into the necromancer's hand and chest in a curling ribbon. The necromancer's eyes glow faint green, his expression calm and grave rather than gleeful. A dim battlefield behind them with broken banners. Palette: ghostly green, black cloak, bone white, muted grey sky.

**Withering Touch** (instant, 3 damage; "Flesh sloughs from bone at the lightest caress.")

Lore: the Tide's slow arithmetic, one touch and the account is settled. No flames, no blast: a quiet, intimate decay. Keep it distinct from Soul Siphon (a necromancer over a body) and Grasp from the Grave (hands from the earth). Square, one clear focal point.

> A close view of a pale, thin bare hand in a ragged black-green sleeve, reaching in from the left and resting two fingertips on the gauntlet of a veteran soldier in dented plate armour. Where the fingers touch, the steel is flaking to rust and the glove beneath is blackening and crumbling, grey-green veins of rot spreading outward across the armour in a branching fan. A small green leaf and a few flowers at the soldier's belt wither and turn to brown dust beside it. The soldier's face is turned half to the viewer, wide-eyed, mouth open in silent horror. A misty graveyard track at dusk behind them. Palette: grey-green, ash black, sickly yellow, rust brown, deep shadow.

## Prompts: Wild (spell)

**Wild Growth** (sorcery, +2/+2; "It never wears off. The forest is not in the habit of taking back.")

> A young stoneback bear cub (or any small beast) in a sunlit forest clearing, caught mid-swell as green light and curling vines wrap around it and its body visibly grows larger and stronger, muscles thickening, moss and small flowers blooming along its fur. Fresh shoots and glowing leaves swirl upward around it. A calm, confident look on its face. Palette: bright spring green, golden light, warm brown fur, soft white blossoms.

## Prompts: Land

**Aether Well** (land, tap for one mana; "It hums with borrowed light.")
Lore: a puncture in the buried body of the dead Sleeper; what rises through it is not water and not light but the last warmth of a dream going cold. Keep it quiet and ancient, not flashy.

> An ancient circular stone well at the centre of a quiet ruined shrine courtyard, its mouth filled with a soft pale blue-gold light that wells up and spills in slow glowing ripples over the stone rim. Tiny motes of light drift upward like fading embers, and faint hairline cracks run through the ancient paving, glowing at the edges. Moss on old stones, a lantern or two, a calm hush. Palette: soft blue-gold glow, mossy green-grey stone, deep blue shadow.

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

**Grave Necromancer: Grave Call (Sael calls the most recently fallen back to your hand)** (delivered as `grave-grin.webp`, cropped to 731x365)
Same shared style line with "Wide 2.5:1 composition". The `grave` band is dark green (`#06140c`) with pale mint and green edges,
so keep the background near black-green. Matches the card art above (Sael: hood, glowing eyes, calm thin smile).

> Wide 2.5:1 extreme close-up of Sael's face, a gaunt pale necromancer under a deep black-green hood, eyes glowing bright pale green and fixed on the viewer, a slow thin smile of quiet certainty. One bandaged hand rises at the right edge of the frame, two fingers curled in a beckoning gesture with a curl of green flame, and ghostly pale-green faces and reaching hands drift up out of the dark haze beside him, answering the call. Faint green motes and ash streak past. Paper ritual tags and a bone-claw necklace just visible at the collar. Palette: black-green, pale mint-green glow, bone white, with bright catchlights in the eyes. Keep the left third dark and calm.

**Plague Priest: Rot (Mother Vess reads your hand aloud, and what she reads is gone)** (delivered as `rot-face.webp`, 1010x401; wired as the `rot` kind)
Lore: Mother Vess prepares the living to rise whole; she is patient, never cruel. Rot makes the opponent discard a card at
random when she enters. Match the card art (tattered green-black vestments, censer smoke, drifting pages). Same shared style
line with "Wide 2.5:1 composition". Keep this one a different colour from the bright mint Grave Call band: murky yellow-green
with candle-gold, so the two Grave Tide cut-ins do not look alike. To wire it: art in `public/ui/rot-face.webp`, a `rot` entry
in `CutIn.tsx` `ART`, `CUTINS` (`Rot: 'rot'`) in `fxTiming.ts`, a colour block in `index.css`, and the shared right-offset rule.

> Wide 2.5:1 extreme close-up of Mother Vess's face, a serene pale priestess under a tattered green-black hood, heavy-lidded eyes lowered as if reading, lips parted mid-recitation, a calm, almost tender expression. A thin curl of grey-green censer smoke crosses the frame, and from the right edge several torn cards and scraps of parchment drift past her, their edges crumbling to ash and spores as if the words on them are being unwritten. Tiny yellow-green motes glow in the dark haze. A single candle-gold catchlight on her cheek. Palette: murky yellow-green, ash grey, bruise-black, candle gold. Keep the left third dark and calm.

**Iron Shogun: The Charge (Tadeo Kurosa rides at the front)** (delivered as `charge-face.webp`, 1009x401; fires when he is declared as an attacker)
Lore: the only Shogun in nine generations to ride at the front, doctrine not bravado: "a commander who sends others to pay a
debt he incurred has not settled it." Match the card art (dark iron armour, crested horned helm). The Iron Blossom Clans have
no cut-in yet, so this one sets their colour: deep crimson and black with a warm gold banner, not the steel-gold of Bulwark's
Flash. Same shared style line with "Wide 2.5:1 composition".

> Wide 2.5:1 extreme close-up of Tadeo Kurosa's face, a battle-scarred Shogun in a dark iron crested horned helm, a deep scar through one brow, eyes hard and level, jaw set, mouth open in a roar to the line behind him. A huge crimson iron-blossom banner whips across the frame at the right edge and a sword blade flashes along the edge of the frame, sparks and dust streaking past as he charges. Faint rows of spear points rise in the dark haze behind him. Palette: dark iron, deep crimson, black, warm gold flecks, with a bright catchlight in the eyes. Keep the left third dark and calm.

**Kensei Duelist: First strike (Hana cuts before the blow can land)** (delivered as `strike-face.webp`, 1024x434; wired as the `strike` kind, plays on the "First Strike!" spotlight when she clashes as the first striker)
Lore: Hana of the Single Breath, who never strikes twice at the same opponent: "One breath, one cut. There is no second."
Match the card art (white and crimson kimono, black hair in a bun held by red pins). In the card art her eyes are closed; for
the cut-in her eyes snap open at the instant of the draw. To stay apart from the crimson-and-black Iron Shogun band and the
Bulwark gold, make this one cold: pale steel-silver and white on indigo-black with a single thread of crimson. Wired: art in
`public/ui/strike-face.webp`, an entry in `CutIn.tsx` `ART`, `FS_CUTINS` in `fxTiming.ts` (so her "First Strike!" spotlight carries the band and
holds longer), and a colour block in `index.css`. Same shared style line with "Wide 2.5:1
composition".

> Wide 2.5:1 extreme close-up of Hana's face, a calm young swordmaster with pale skin, black hair in a bun held by red pins, a thin line of crimson at the lips, her eyes snapping open at the instant of the draw, pupils sharp and fixed on the viewer, utterly still. A bright silver katana blade flashes across the lower right of the frame in a single long streak of light, a perfect white arc of cut air behind it, and a drifting cherry blossom is sliced cleanly in two, both halves hanging in the air. Fine ink-wash speed lines and a few specks of dust trail past. A hint of white kimono collar with a crimson edge at the bottom of the frame. Palette: steel silver, white, deep indigo-black, with one thread of crimson, and bright white catchlights in the eyes. Keep the left third dark and calm.

**Storm Drake: Thunder (Vael's wings break the sky)** (delivered as `thunder-face.webp`, 1002x399; fires when it enters)
Lore: Vael, the Storm Drake: "Thunder is merely the sound of its wings." Drakes are not bred, bound or owned; they roost near
the holds because the holds are warm. The Skyward tradition has no cut-in yet, so this sets its colour: electric blue-white
on storm slate, clearly different from the green and gold bands. The face is a drake's, so the eye is the point.

> Wide 2.5:1 extreme close-up of Vael's face, a huge storm drake in profile three-quarter view, one slit-pupilled eye blazing pale yellow-white and fixed on the viewer, scaled brow ridges and a long jaw with teeth bared in a snarl, steel-blue scales edged with crackling blue-white lightning. A forked bolt of lightning splits the dark storm cloud at the right edge of the frame, and rain and wind streak past sideways. Palette: storm slate, electric blue-white, deep teal-black, with a bright yellow-white eye. Keep the left third dark and calm.

**Rotting Hulk: Last breath (the Hulk dies and a Zombie crawls out)** (delivered as `breath-face.webp`, 1011x398; fires when it dies)
Lore: Grave Tide's patient arithmetic: nothing is wasted. Match the card art (bloated grave-flesh, thick sutures, rusted hooks). To
stay apart from the mint Grave Call and the yellow-green Rot bands, make this one bruised purple and putrid green. A face
would be a dead one, so show the Hulk's slack, dying face with the Zombie emerging beside it.

> Wide 2.5:1 extreme close-up of the Rotting Hulk's face as it dies, a huge bloated grey-green brute with a stitched-shut eye, thick ragged sutures across the brow and cheek, a rusted hook through one ear, its jaw sagging open on one last breath that escapes as a pale purple-green mist. Beside its cheek at the right edge of the frame a small pale zombie pushes its head and one hand out through a rip in the Hulk's neck, eyes wide and glowing faint green. Dark crypt gloom and drifting spores behind. Palette: bruised purple, putrid green, dirty bone, black, with a faint green glow in the Zombie's eyes. Keep the left third dark and calm.

**Thornwood Brute: Whipflash (a lash of green thorn, 1 damage to a creature)** (delivered as `whip-face.webp`, 1002x394, on a dark background; the old white-background art and its multiply trick are gone)
Lore: Brutes condense out of the Thornwood when the forest's patience fails; the lash of green that comes with one arriving is
"the forest clearing its throat." The Brute looks like a big panda-faced bear: cream face and chest, dark eye patches and ears, thick
brown fur, thorned vines wrapped round its arms and body (match the card art). Today's cut-in art is on a white background, so
the game multiplies it over a green gradient band (`.blitz-ult.whip .bu-art { mix-blend-mode: multiply }`). If this redo is on a
dark background, drop that multiply and give the `whip` band a dark green `--cut-bg` like the others. Same shared style line with
"Wide 2.5:1 composition".

> Wide 2.5:1 extreme close-up of the Thornwood Brute's face, a huge panda-faced bear with a cream face, dark eye patches and ears, thick brown fur and glaring white-lit eyes, jaw open in a snarl with bared fangs. Thorned green vines wrapped round its shoulders and arm whip forward across the right edge of the frame in a cracking lash, the thorns flashing and torn leaves and bark chips streaking past. Deep dark forest-green shadow behind it with faint tree trunks. A bright green flash where the vine cracks. Palette: forest black-green, bright thorn green, cream and dark brown fur, with a white glint in the eyes. Keep the left third dark and calm.

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
