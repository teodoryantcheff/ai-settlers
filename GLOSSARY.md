# Colony

Terms for colony production, goods accounting, natural resources, construction, road planning, and production feedback.

## Language

**Stored stock**:
Goods physically held in colony storage, including goods already reserved for collection.
_Avoid_: Available stock, when reservations have not been subtracted; total goods, when goods outside storage are excluded.

**Reserved stock**:
The portion of stored stock promised for collection. It remains part of stored stock until collected and is not an additional quantity of goods.
_Avoid_: Goods in transit, before collection; adding reservations to stored stock.

**Available stock**:
Stored stock remaining after reservations are subtracted.
_Avoid_: Stored stock, when describing goods not already promised for collection.

**Goods in transit**:
Goods physically carried between locations after collection and before delivery.
_Avoid_: Reserved stock; all assigned deliveries, including those not yet collected.

**Producer input stock**:
Ingredients physically held at a producer for its production cycles.
_Avoid_: Stored stock, when referring to ingredients held outside colony storage.

**Output awaiting collection**:
Finished goods physically held at a producer before collection for delivery.
_Avoid_: Delivered output; goods in transit, before collection.

**Producer input arrivals**:
Ingredients delivered to a completed producer's input stock. Assignment and collection are not arrivals.
_Avoid_: Construction deliveries; ingredients on the way, when describing completed arrivals.

**Producer output delivered to storage**:
Goods produced by a building that have reached colony storage. Output awaiting collection and goods still carried are not delivered output.
_Avoid_: Collected output, when describing arrival at storage; warehouse transfers.

**Colony lifetime production**:
Goods produced throughout the colony's recorded history, including production by buildings that have since been demolished.
_Avoid_: Current producers' lifetime totals, when describing the entire colony's history.

**Recipe requirements**:
The kinds and quantities of ingredients required for one production cycle, including any alternatives. A mine requires one edible good.
_Avoid_: Ingredients consumed next, when describing the general requirement.

**Eligible ingredients**:
The goods that can supply a building's current production recipe. Every edible good is eligible for a mine, regardless of which meal it will consume next.
_Avoid_: Selected ingredients.

**Ingredients consumed next**:
The specific goods and quantities selected from a building's stock for its next production cycle. A mine selects its most plentiful edible good, with a stable order for ties.
_Avoid_: Recipe requirements, when describing the selected goods.

**Edible good**:
A good that can satisfy a mine's meal requirement: bread, meat, fish, or provisions.
_Avoid_: Food, when it could mean provisions alone.

**Deposit**:
A finite mineral seam in a mountain tile containing coal, iron ore, or gold. A neighboring mine removes one unit per successful production cycle.
_Avoid_: Reserved stock; a producer's collected ore.

**Construction progress**:
The fraction of a building site's construction work completed after all required materials arrive.
_Avoid_: Production progress; delivered materials, when describing completed work.

**Manned outpost**:
A completed outpost that has received its soldier and can claim its full territory radius.
_Avoid_: Completed outpost, when the soldier has not yet arrived.

**Sent notice**:
A record that a particular condition has already been reported for a building, used to suppress repeat reports until successful production clears it.
_Avoid_: Current shortage or resource availability, which may change after the report.

**Road plan**:
The preferred route between two endpoints and the clear, owned tiles that would gain road pavement in the current colony, or the reason the road cannot be built. A route can pass through occupied tiles without paving them, but its starting tile must be clear and owned.
_Avoid_: Walking path, when describing which tiles will be paved.

**Economic notice**:
A player-facing report that production has started, remained blocked, or recovered, identifying the affected producers and the reason where applicable.
_Avoid_: Production sound, when referring to the information rather than its optional audible cue; economic history, when referring to a transient report.

**Checkpoint**:
A named, player-created record of a colony that can be restored later. It remains available until explicitly overwritten or deleted.
_Avoid_: Autosave, when referring to a checkpoint the player chose to retain.

**Autosave**:
The colony record automatically replaced during active play, separate from named checkpoints.
_Avoid_: Checkpoint, when referring to the automatically replaced record.
