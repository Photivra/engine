# Content Credentials (C2PA) in exports

Engine 2.22.0 adds the engine half of [#165](https://github.com/Photivra/photivra/issues/165): functions that put a C2PA
Manifest Store into a JPEG, PNG or DNG export, keep the data hash valid while the store is signed, and find a store already
in a file. The application builds the manifest, signs it, validates it and decides what to do when signing is not possible;
the engine only handles the file bytes.

- `bindC2paManifestStore({ file, manifestStore })` embeds a placeholder store and returns the new file and its **binding**:
  the `c2pa.hash.data` exclusions and where the store sits.
- `calculateC2paDataHash({ file, exclusions })` returns the SHA-256 over every byte outside the exclusions (Web Crypto).
- `setC2paManifestStore({ file, binding, manifestStore })` writes the signed store over the placeholder. It must have exactly
  the placeholder's length, so no offset moves and the hash computed before signing still holds.
- `parseC2paManifestStore({ file })` finds the store embedded in a JPEG, PNG or TIFF/DNG and returns a copy of it and its
  binding, or `null` when there is none. It does **not** read the manifests, check the hash or verify a signature.

`C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE` is the IPTC digital source type for an image the engine simulates,
`http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia` (owner decision on #165, 2026-11-10), for the
application's `c2pa.created` action (C2PA 2.4 §18.15). The engine does not write it: it never builds JUMBF or COSE.

What the engine does **not** do: hold keys, sign, call a network, build or parse the manifests inside the store, or validate a
signature. The functions are browser-safe, add no dependency, and are imported by nothing in the capture path, so the capture
worker's bundle does not include them (`test/capture-bundle.test.ts` asserts it; the worker measures 363,695 B gzip with and
without them). An application that imports all four adds 4,883 B gzip (11,978 B minified; rolldown 1.2.9, measured 2026-11-11).

All section numbers below are from the [C2PA Technical Specification 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html) (April 2026).

## Workflow (§10.4, "Multiple Step Processing")

1. Export the JPEG, PNG or DNG as usual.
2. Build a **placeholder** manifest store: the claim with a `c2pa.hash.data` assertion whose exclusion `start` and `length`
   are written as 32-bit integers and whose `pad` is zero bytes, and a temporary COSE_Sign1 whose `pad` reserves room for the
   signature (§10.4.1–§10.4.2; the specification recommends 25 KB). Its length is final from here on.
3. `bindC2paManifestStore` embeds it. Write `binding.exclusions` into the data hash assertion, adjusting `pad` so its box
   keeps its size (§10.4.4).
4. `calculateC2paDataHash` hashes the bound file. Write the hash into the assertion, then sign the claim.
5. Build the final store at the **same length** (shrink the COSE `pad` by the signature's size) and call
   `setC2paManifestStore`. If the signature does not fit, start again from step 2 with more padding.

Steps 2, 4 (signing) and 5 (building) are the application's. Nothing in the file changes between steps 3 and 5 except
bytes inside the exclusions, so the hash from step 4 is the hash of the final file.

## Byte layouts

The engine writes what the C2PA reference SDK (c2pa-rs) writes for each format (owner decision on #165, 2026-11-11), so the
same store gives the same file bytes.

### JPEG (§A.3.1, §18.5.3)

| What | Where |
| --- | --- |
| Segments | APP11 (`FF EB`), `Lp`, `CI` = `JP`, `En` = `0x0211`, `Z` = 1, 2, …; continuation segments repeat the store's `LBox` and `TBox` (ISO 19566-5:2023 D.2) |
| Split | 64,000-byte pieces of the store |
| Position | one contiguous run right after the last APP0 (JFIF) segment, or right after SOI when there is none; the specification sets no position, only contiguity |
| Exclusions | one range: every C2PA APP11 segment, each `FFEB` marker and `Lp` field included (§18.5.3) |

`manifestStore` may also be the store already split into APP11 segments (what the reference SDK's placeholder call returns
for JPEG), as long as the split is the one above; anything else is rejected rather than re-split.

### PNG (§A.3.2, §18.5.4)

| What | Where |
| --- | --- |
| Chunk | one `caBX` chunk (ancillary, private, not safe to copy; PNG 3rd edition §4.7.2): Length, `caBX`, the store, CRC-32 over type and data |
| Position | right after IHDR, so before every IDAT, as §A.3.2 recommends |
| Exclusions | one range: the whole chunk, 12 + store length bytes. §18.5.4 requires the Length and type in it; the CRC is included too because it changes with the store |

`setC2paManifestStore` recomputes the chunk's CRC with the new store; the CRC is inside the exclusion.

### DNG and TIFF (§A.3.6, §18.5.5)

| What | Where |
| --- | --- |
| Entry | tag 52545 (`0xCD41`), type 7 (UNDEFINED), count = store length, in the single main IFD at its ascending tag position |
| Store | at the end of the file, on a 4-byte boundary (the section recommends the end of the file) |
| Rest of the file | every byte from the new entry on moves 12 bytes, and every offset to such a byte (entry values, StripOffsets, TileOffsets, SubIFDs, Exif, GPS and Interoperability IFDs) moves with it; 12 keeps every alignment |
| Exclusions | two ranges: the entry's 4-byte count field (§18.5.5 recommends it) and the store |

The binding's `mediaType` is `image/dng` when the main IFD has DNGVersion (50706), else `image/tiff`. The store's own bytes
are big-endian JUMBF whatever the TIFF byte order (§A.3.6).

## Finding an existing store

`parseC2paManifestStore` reads files from other writers too:

- **JPEG:** the store starts at a JUMBF APP11 segment (`CI` = `JP`) with `Z` = 1 whose box is the C2PA superbox; its
  continuations follow at once with the same `En` and `Z` + 1, whatever their split. Other JUMBF APP11 segments (for example
  JPEG 360) are skipped. A second C2PA store, or a C2PA segment that is not contiguous with the run, is rejected (§A.3.1).
- **PNG:** the one `caBX` chunk, wherever it is; a second one is rejected.
- **TIFF/DNG:** tag 52545, which must be the only such entry and sit in the last IFD of the main chain (§A.3.6), either in a
  single main IFD or alone in its own IFD.

The binding it returns uses the exclusions above for the store's actual position (for TIFF, sorted when another writer put
the store before its IFD). That is what `setC2paManifestStore` needs to replace the store in place, keeping the file's own
segment split. A validator uses the manifest's own `c2pa.hash.data` assertion instead, which may list different ranges.

## What is checked

- The store's outer framing (§11.1.4.2): one JUMBF superbox (`jumb`) whose LBox is its whole length, starting with a
  description box (`jumd`) with the C2PA UUID `63327061-0011-0010-8000-00AA00389B71` and the label `c2pa`, and child boxes
  that fill it exactly. 38 B to 32 MiB (`C2PA_MANIFEST_STORE_MAXIMUM_BYTES`, an engine limit, owner decision 2026-11-11).
- One store per file: `bindC2paManifestStore` rejects a file that already has one.
- TIFF writing: classic TIFF with exactly one main IFD, ascending tags and every entry inside the file. A MakerNote (37500) or
  DNGPrivateData (50740) is rejected, because their inner offsets cannot be moved safely. PNG: chunks must run from IHDR to IEND
  inside the file. Every JPEG, PNG and DNG the engine writes meets these conditions.
- `setC2paManifestStore`: the binding must equal the one found in the file, and the new store must have the reserved length.
- `calculateC2paDataHash`: exclusions ascending, non-overlapping and inside the file (§18.5.1). It copies the bytes outside
  the exclusions into one array before hashing, so it needs about one more file's worth of memory.

## Evidence

`test/c2pa-embed.test.ts` checks, on the engine's own photographic-export JPEG and DNG and its PNG encoder's output:

- **JPEG:** the bound file with the excluded range taken out is the original byte for byte; the markers run SOI, APP0, APP11,
  APP1 … SOS, entropy data, EOI; a 150,000 B store makes three segments of 64,000, 64,000 and 22,000 store bytes with Z 1–3.
- **PNG:** the same byte-for-byte check; every chunk's CRC matches Node's CRC-32; the decompressed image data is unchanged; the
  chunk order is IHDR, caBX, then the original chunks.
- **DNG:** the file reads the same through `parseDngRawImage` (codes, levels, matrices, crops), also for a big-endian DNG with
  a SubIFD and data on both sides of the main IFD; the entry is type 7 with the store at the 4-aligned end.
- The signed file has the same length, the same bytes outside the exclusions and the same data hash, in all three formats.
- The reader returns exactly the writer's binding and store for all three formats, `null` for files without a store, and reads
  and patches a JPEG with another split and `En` placed after Exif (next to a non-C2PA JUMBF segment) and a TIFF with the store
  alone in a second IFD.
- `calculateC2paDataHash` equals Node's SHA-256 over the concatenated kept bytes.
- Wrong lengths, second stores, non-contiguous or misplaced stores, mismatched bindings and malformed stores fail with
  `InvalidConfigurationError`.

Locally (macOS ImageIO through `sips`, 2026-11-11, not in CI) the bound JPEG and PNG decode to the same pixels as the originals.

**Pending external validation:** no C2PA validator (the reference SDK or its command-line tool) was run on these files,
because none is available offline here and the engine cannot sign. Validating signed JPEG, PNG and DNG files with the reference
tooling belongs to the application's signing work; the DNG should also be opened in a DNG reader with the store present.

## Example

See [Content Credentials in exports](USAGE.md#content-credentials-in-exports-165) in the usage guide.
