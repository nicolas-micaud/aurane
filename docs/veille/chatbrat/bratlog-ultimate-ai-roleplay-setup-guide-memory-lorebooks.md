# AI Roleplay Setup Guide: Memory and Lorebooks

Source : https://chatbrat.ai/ultimate-ai-roleplay-setup-guide-memory-lorebooks (version blog de l'article Medium ; capture curl du 26.09.2026, lecture seule ; HTML brut dans `bratlog-ultimate-ai-roleplay-setup-guide-memory-lorebooks.html`).

AI Roleplay Setup Guide: Memory and Lorebooks 
 c 

 Home Chats 
 Create Games Profile Home Chats 
 Create Games Profile chatbrat.ai T 
 — +

 Home 
 / Bratlog 
 / ultimate-ai-roleplay-setup-guide-memory-lorebooks 

 Loading… 
 About Pricing Careers Safety Center Community Guidelines Child Safety Report Illegal Content Transparency Law Enforcement DMCA Community Chat Bratlog Research Education Videos Alternatives Cookie Policy Privacy Policy Terms of Service Tokens Terms of Use Your Privacy Choices Contact We don't sell your data, and we use no-training / no-retention terms with our AI providers.
 © 2026 chatbrat.ai AI-powered character chat — not a substitute for professional advice 
 Discord Reddit 

 Guides AI Roleplay Setup Guide: Memory and Lorebooks
 Garret Williams 
 Published Jun 24, 2026 11 min read 

 Try it free — no signup required to browse
 Pick a character. Start the scene. Memory keeps the story straight.
 ChatBrat is SFW companion + roleplay chat with persistent memory. Jump into a character or a social-deduction game — guest-friendly where marked Play Free.
 Browse characters → Play a free game 

 Most AI roleplay disappointments share one root cause: the AI does not know enough about the world it is in, the character it is playing, or where the story is supposed to go. The session starts well and then drifts. The character's voice shifts, a crucial detail from three messages ago vanishes, and whatever emotional momentum you built evaporates. This guide explains exactly how to fix all of that.
 The tools exist. Lorebooks, persistent memory, layered world context, and multi-character composition are all real features. Nobody documents them well anywhere, and that is the gap this guide fills. By the end you will know how to build an AI session that runs like a tightly-produced story instead of a generic chatbot conversation.
 Try it on our most-played scenarios
 Chat With Mommy A warm AI Mommy who's endlessly proud of you, no matter what kind of day you had.
 Start Scenario → 

 Mafia Boss's Forbidden Daughter The mafia don's daughter. Forbidden. Dangerous. Worth the risk, she says.
 Start Scenario → 

 Why Most AI Roleplay Falls Flat
 Every AI session starts with a context window: the set of information the model can see at any given moment. Generic AI tools give you a system prompt and a chat history, and that is it. The moment the conversation gets long enough, early details scroll out of the window and the AI forgets them. The NPC's name, the secret the character was keeping, the world's magic rules all disappear.
 The fix is structured context layering : loading the right information at the right time, in the right format, so the AI always has what it needs to stay consistent. ChatBrat's creator engine is built around exactly this principle, and it uses four distinct building blocks that stack on top of each other.
 1. The Four Building Blocks
 Understanding each piece before you combine them makes everything else click. Here is what each one does and how the engine interprets it.
 Characters
 A character in ChatBrat carries far more than a name and a profile picture. The full character card compiles into a structured system prompt block that the AI receives at the start of every session. The fields that matter most:
 Bio: background, psychology, history, secrets. The richest source of behavioral constraints. The AI uses this to decide what your character would or would not say in any given situation.
 Personality: a free-form text field that describes voice, affect, and behavioral dynamics. This is where you write things like “deflects vulnerability with dry humor” or “never says sorry directly, apologizes through actions.” Specificity here separates a character with genuine voice from a generic assistant in a costume.
 Personality Sliders: warmth, dominance, playfulness, intensity, and other axes on a 0–100 scale. These inject calibrated soft constraints on top of the freeform text.
 Opening Lines: the first message the character sends. This sets the scene, establishes tone, and models the voice for everything that follows. A well-written opening is worth more than a hundred lines of bio.
 Lorebook: keyword-triggered lore entries (covered in full in section 2).
 For a concrete example of how deep character construction translates into a distinct in-session voice, try Yoru Kurosaki, a dark-romance anti-hero whose lorebook and bio create a genuinely layered persona . Notice how the character's voice stays consistent even when you steer the conversation into unexpected territory.
 Worlds
 A world defines the physical and social rules of the universe your character inhabits. When a world is attached to a session, the AI can see its description, its named locations, and its factions, so it references the world's geography and power structures naturally instead of fabricating contradictory details each time.
 World fields include: world type (Kingdom, Post-Apocalyptic, Space/Ship, Other Plane, etc.), a free-form world description, named Locations with individual descriptions, and Factions with descriptions. Tags (Setting, Tone, Magic & Power, Society, Era) further tune the AI's frame of reference.
 A world without named locations is just a vibe. Name at least three specific places (a tavern, a market, a ruin) and the AI has anchor points to return to, which makes the world feel lived-in instead of generated on demand.
 Scenarios
 A scenario is the core play unit. It defines the opening situation, the cast of characters, and the linked world. Think of it as a stage direction for the session's opening scene. The fields that matter:
 Opening Narration: the situation the user walks into. The engine injects this as the scene-setting context before the character speaks. It establishes physical location, time, stakes, and mood in a single authoritative paragraph.
 Cast: the characters assigned to this scenario. When you use Compose (see section 4), the engine auto-suggests the scenario's cast, keeping the lineup coherent.
 Mood: Romantic, Tense, Mysterious, Dark, Playful, Emotional, Action, Dangerous, or Custom. This tunes the AI's register for the session.
 The Murder in the Mist Victorian mystery scenario shows this well. The opening narration drops you into a specific situation with specific stakes, the cast is pre-defined and interrelated, and the world context keeps the period dialogue consistent. That is the scenario contract working correctly.
 Story Arcs
 A story arc is the narrative trajectory layered on top of the opening scenario. Where the scenario establishes where you are , the arc establishes where this is going . Think of it as a spine, not a script.
 Arc fields: Premise (what this arc is fundamentally about), Chapters (1–10 titled beats), Emotional Beats (the specific emotional shifts that should happen across the arc), and Required Decisions (pivots where the user's choice matters). The engine injects the arc as a dynamic suffix block. The scenario breathes for the first few exchanges, then the arc's threads begin weaving in naturally.
 One rule matters most: the arc is a direction, not a checklist. Write chapter titles like “The trust starts to crack” instead of “User learns about the betrayal.” The AI fills the specific moments while the arc points the compass.
 2. How AI Lorebooks Actually Work
 A lorebook is a set of keyword-triggered context entries that get injected into the AI's context window automatically when specific words appear in the conversation. This is one of the most powerful and least-understood features in AI roleplay tooling.
 How the mechanics work: Each lorebook entry has a set of trigger keywords, a block of lore text, and an injection position (before the character block, after it, or at a specific depth in the conversation). When the conversation contains a trigger keyword, the engine injects that entry's lore text into the active context window at the specified position, then removes it again once it is no longer relevant.
 This solves one of the deepest problems in long AI sessions. You cannot keep every fact about a complex world in the AI's context window all the time, because the window fills up. A lorebook works as a selective memory system: the AI only loads information when the conversation actually needs it.
 Lorebook Best Practices
 Write entries that answer “what does this mean in this world?” When the conversation touches “the Veil” or “the Accord” or any proper noun specific to your setting, the lorebook entry for that term should explain its significance, not just define it. “The Veil is a magical barrier” is a definition. “The Veil has been failing for two years; everyone in the city knows something is wrong but no one says it out loud” is lore.
 Use position strategically. “Before character” entries establish foundational facts before the character speaks, which suits world rules and lore the character would know. “After character” entries add supplementary context after the character block, which suits scene-specific details. “At depth” entries inject at a specific position in the conversation history, which suits things that should surface only once the conversation has developed.
 Name your entries for maintenance. You will build more of these than you expect. An entry labeled “The Accord: political history” is much easier to audit and update than entry #7 with no label.
 Characters like Yoru Kurosaki and scenarios like Veiled Vows lean heavily on lorebook entries to maintain deep consistency across long sessions. These characters hold up under extended play for one reason beyond good bio writing: the critical facts about their world are lorebooked and cannot be forgotten.
 3. Persistent Character Memory
 Memory and lorebooks are different systems. The lorebook is creator-authored context: facts about the world and character that you wrote in advance. Persistent memory is session-accumulated context: facts that emerged from the conversation itself and need to be retained across sessions.
 Without persistent memory, every new session with the same character starts cold, and the AI has no recall of what was said before. This is why generic AI tools fail for ongoing roleplay: you rebuild the relationship from zero every time. With persistent memory, the character knows your name, remembers what happened in previous sessions, and can reference the specific moments that shaped the relationship.
 This pays off most for relational archetypes, the characters built around an ongoing emotional dynamic instead of a one-off encounter. If you are deciding which dynamic to build around, our breakdown of the tsundere archetype covers the one that depends most on a long arc, since the hostility only means anything once it has had time to crack. The kuudere versus dandere comparison explains why two characters who both read as “quiet” need completely different memory setups. The You Met on Vacation character is a good example: the entire texture of that character depends on a shared history accumulating over time. Without persistent memory, it's just a warm one-shot. With it, it becomes an ongoing relationship with real continuity.
 For the full breakdown of how ChatBrat's memory system works and how to get the most out of it, see the long-term memory feature overview or the persistent AI character companion guide .
 New here? Start an AI roleplay chat , browse the full dere types guide for character personalities, or see how ChatBrat stacks up as a Character AI alternative for roleplay and a Zeta AI alternative .
 4. Multi-Character Compose: Stacking All Four Layers
 Compose is the feature that ties everything together. At chatbrat.ai/compose , you pick any combination of a character, a world, a scenario, and a story arc, then launch a session that has all four layers of context active simultaneously.
 Here is what happens under the hood when you hit launch:
 The character's bio, personality, and lorebook compile into the base system prompt.
 The world's description, locations, and factions inject as a world context block.
 The scenario's opening narration injects as the scene prefix, which the AI reads as the opening situation.
 The story arc's premise and chapters inject as a dynamic suffix, a direction the narrative should travel that unfolds naturally as the conversation develops.
 The session tone (Romantic Tension, Dark Psychological, Found Family, etc.) tunes the AI's register across all of the above.
 The net effect: the AI enters the session knowing the character, the world, the opening situation, and the narrative direction. None of these layers fight each other, because the engine assembles them in the right order.
 The best example of this in practice is Veiled Vows, a fully composed multi-character mystery with layered lorebooks, a detailed world, and an arc that runs across the full session . Notice that every character in the ensemble holds their own consistent voice, and the information they each reveal or conceal tracks against the arc. That coherence is a product of the compose system, not luck.
 For the Bank Robbery Accomplice scenario , Compose lets you load a specific character's psychology, a crime-world setting, and an arc that escalates the stakes, all active in a single session, so the AI never loses the thread of what kind of story this is.
 5. The Mom AI Character: A Deep Dive
 “Mom AI character” is one of the most searched archetypes in AI roleplay and one of the most underserved. People looking for this want something specific: a warm, grounded, emotionally consistent presence with a clear relational identity. Not a generic assistant. Not a flirtatious persona. A character whose defining quality is how they see you .
 Warmth is the hardest quality to maintain in an AI character. It demands specificity at every level: specific personality traits, specific speech patterns, specific emotional beats. Vague warmth turns to flatness after a few messages. Here is exactly how to build a Mom AI character (or any nurturing archetype) that holds up:
 Step 1: Bio, Ground the Character in Specific History
 A nurturing character needs a reason for their warmth, a history that explains why they show up the way they do. Skip “she is warm and caring.” Write the specific losses or experiences that made her this way. The people she worries about and why. The thing she will never forgive herself for. What makes her laugh despite herself.
 The bio is where you write the backstory that the AI uses to make in-the-moment decisions. A character with a grounded history responds differently to vulnerability, conflict, and humor than a character described only by adjectives.
 Step 2: Personality, Encode the Voice, Not Just the Vibe
 In the Personality field, write how the character speaks , not just how they feel. Specific voice markers for a warm maternal archetype might look like:
 Warm but not saccharine. Pays attention to small details, the thing you mentioned offhand three conversations ago. Gives advice sideways: never tells you what to do directly, but asks the question that makes you figure it out. Gets quiet when she's worried, which means more than when she talks. Has a dry wit she pretends she doesn't have. Will not pretend things are fine when they aren't.
 Notice the difference between this and “warm, caring, maternal.” The first gives the AI behavioral handles, specific things to do in specific situations. The second gives it a vibe to perform, which collapses under pressure.
 Step 3: Opening Lines, Set the Emotional Register from Message One
 The opening message is the most important field in the entire character card. It models the voice the AI should maintain across the whole session. For a maternal archetype, the opening should demonstrate three things: attention to the user, warmth without condescension, and a specific situation that already implies history.
 Compare these two openings for the same archetype:
 Weak opening
“Hello! I'm here for you. How are you feeling today? I'm always here to listen and support you.”
 Strong opening
“You have that look. The one you get when something's been sitting with you for a while and you haven't said it out loud yet. Come sit. I made the soup you like.”

 The second opening implies history, uses specific sensory detail, and shows that this character sees the user, which is exactly what people searching for a “Mom AI character” want. That attentiveness is the archetype.
 Step 4: Story Arc, Give the Relationship a Direction
 Even for a nurturing archetype, a story arc separates a relationship that deepens from one that stays in the same emotional lane forever. An arc for a maternal character might be titled something like “The distance closes,” with chapters marking the moments where the user lets the character in a little further. The arc does not need to be dramatic. It needs to be directional.
 For emotionally resonant archetypes built around confession and being truly heard, explore what the Confess to the Priest character does to hold space for depth without breaking character, then apply that structural approach to whatever nurturing persona you are building.
 6. Advanced: Scenario + Arc Layering
 The most common creator mistake is using a scenario or an arc instead of both. Here is the distinction that makes them complementary:
 The scenario answers: “Where are we when this starts?” It is a single, specific opening moment.
 The arc answers: “Where is this going over the course of the conversation?” It is the narrative trajectory across an extended session.
 Together they give the AI both an entry point and a destination, which is the structural difference between a session that feels like it means something and one that wanders.
 The engine honors this hierarchy explicitly. The scenario's opening narration runs first, the character establishes its voice in the early exchanges, and then the arc's threads begin to surface naturally: the first beat in chapter one, the tension that builds toward chapter two. The AI does not announce arc transitions. They emerge from the conversation organically.
 For complex settings where the arc involves multiple reveals across a large cast (a murder mystery, a political intrigue, a heist), the combination of scenario opening, story arc beats, and a lorebook that surfaces relevant facts at the right moments makes the reveal feel earned instead of arbitrary.
 See the AI worldbuilding guide for how to build the world layer that holds all of this together, and the LARP and cosplay character prep guide for how to apply these same techniques to preparing a character you will actually perform.
 Build your setup now.
 Characters, worlds, scenarios, and story arcs are all free to create on chatbrat.ai. Start with a single character and compose from there.
 Go to Creator → 
 Frequently Asked Questions
 What is an AI lorebook and why does it matter? A lorebook is a set of keyword-triggered context entries that get injected into the AI's active context window when specific words appear in the conversation. Instead of loading all your world lore upfront (which fills the context window), the lorebook only loads the relevant entry when it's needed. This means the AI always has access to the right facts at the right moment without crowding out the conversation history. It is the single most effective tool for maintaining consistency in long or complex roleplay sessions.
 How is persistent AI memory different from a lorebook? A lorebook is creator-authored: you write the entries in advance before the session starts, describing facts about the world and character. Persistent memory is session-accumulated: it captures what happened in the conversation itself, the things the user said, choices they made, moments they shared, and retains them across future sessions. Both are necessary for a fully realized AI character. The lorebook provides the world's fixed facts; persistent memory provides the relationship's living history.
 How do I set up a multi-character AI scene? Use Compose at chatbrat.ai/compose . Select your scenario (which includes a defined cast), and Compose will auto-suggest the cast members. You can then add a world for setting context and a story arc for narrative direction. The session launches with all layers active, and each character in the cast has their own bio and lorebook, so their voices stay distinct across the session. For a working example of how multi-character sessions play out with a full ensemble, Veiled Vows is the best reference.
 What is the best way to build a Mom AI character on ChatBrat? The key is specificity at every level. In the Bio, give her a concrete history, not just “nurturing” but the specific experiences that shaped her. In the Personality field, encode specific speech patterns and behavioral tells instead of adjectives. Write an Opening Lines message that implies a shared history and shows attentiveness from the first message. Optionally, add a Story Arc with chapter beats that mark deepening trust, since even low-drama arcs give the relationship a direction that prevents it from staying flat. The Personality sliders for warmth, playfulness, and assertiveness let you dial in the exact texture you want.
 What is the difference between a Scenario and a Story Arc? A scenario establishes where the session starts: the physical location, the opening situation, the stakes, the cast. It is a single, specific moment in time. A story arc establishes where the session is going: the narrative trajectory, the emotional beats, the pivots where choices matter. Used together, the scenario provides the entry point and the arc provides the direction. The engine honors the hierarchy: the scenario breathes for the first few exchanges, and then the arc's threads surface naturally as the conversation develops.
 Can I import a SillyTavern character card into ChatBrat? Yes. ChatBrat supports SillyTavern V2 character card import and export from the character creator. The import reads the character's bio, personality, first message, and lorebook entries, and maps them into the ChatBrat field structure. This means you can bring in a character you built in SillyTavern and immediately layer on world context and story arcs using Compose.

 The Gap Was Always Setup
 The AI roleplay sessions that feel genuinely immersive and surprising did not come from a better model. They came from a creator who took the time to build the context properly. A detailed character with a working lorebook, a world with named locations, a scenario with a strong opening narration, and an arc that gives the story somewhere to go: these are the inputs that produce outputs worth remembering.
 The tools are there. Now you know how to use them.
 # how to make ai remember roleplay # ai roleplay that remembers everything # how to set up a lorebook for ai roleplay # ai roleplay persistent memory setup # how to keep ai in character during long roleplay # multi character ai roleplay guide # best ai for long roleplay with memory # what is a lorebook in ai roleplay # how to build an ai roleplay world # ai lorebook tutorial 

 About the author
 Garret Williams
 Garret Williams is the founder and CEO of chatbrat.ai, building at the frontier of AI companions and roleplay chatbots. A Michigan native who attended the UCLA School of Theater, Film and Television (TFT) , he directed acclaimed film projects before pivoting to tech, including his TV pilot Self-Care (nominated for Best TV Episodic at the 2023 Mammoth Film Festival) and Eco-Riot (featured on MasterClass). He writes The Bratlog to document the uncharted territory of AI relationships, sharing real-time lessons and tackling the open questions nobody has answered yet.

 Keep reading

 Guides Turn Your D&D Character Into an AI Companion

 AI Comparisons Best AI for Worldbuilding in 2026 (Ranked for Writers, GMs & Creators)

 Guides AI for Cosplay and LARP: Backstory and Dialogue

 On this page
 01 Why most AI roleplay falls flat 
 02 1. The four building blocks 
 03 2. How AI lorebooks work 
 04 3. Persistent character memory 
 05 4. Multi-character Compose 
 06 5. The Mom AI character deep dive 
 07 6. Advanced: Scenario + Arc layering 
 08 FAQ