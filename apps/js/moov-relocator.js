/**
 * MoovRelocator - JavaScript MP4 MOOV Atom Relocator
 *
 * Ported from PHP moov_relocator by Benjamin Carl.
 * Relocates the MOOV atom from the end to the beginning of an MP4 file
 * for progressive download / streaming support.
 *
 * Works entirely in the browser using ArrayBuffer / DataView.
 *
 * @license BSD
 */

const MoovRelocator = (() => {
  // Known MP4 atom types
  const ATOM_TYPES = {
    FTYP: 'ftyp',
    MOOV: 'moov',
    STCO: 'stco',
    CO64: 'co64',
    CMOV: 'cmov',
    URL:  'url ',
    XML:  'xml ',
  };

  const KNOWN_ATOMS = new Set([
    'ftyp','moov','mvhd','trak','tkhd','mdia','mdhd','hdlr','minf',
    'vmhd','smhd','dinf','dref','url ','stbl','stsd','stts','stss',
    'stsc','stsz','stco','co64','ctts','udta','meta','ilst','free',
    'skip','mdat','edts','elst','cmov','xml '
  ]);

  function isValidAtom(type) {
    return KNOWN_ATOMS.has(type);
  }

  /**
   * Parse all top-level atoms from an ArrayBuffer.
   * @param {ArrayBuffer} buffer
   * @returns {Array<{offset:number, size:number, type:string}>}
   */
  function parseAtoms(buffer) {
    const view = new DataView(buffer);
    const atoms = [];
    let offset = 0;

    while (offset < buffer.byteLength) {
      if (offset + 8 > buffer.byteLength) break;

      let size = view.getUint32(offset);
      const type = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );

      // 64-bit extended size
      if (size === 1) {
        if (offset + 16 > buffer.byteLength) break;
        const high = view.getUint32(offset + 8);
        const low  = view.getUint32(offset + 12);
        size = high * 0x100000000 + low;
      }

      if (size === 0) {
        // extends to end of file
        size = buffer.byteLength - offset;
      }

      atoms.push({ offset, size, type });
      offset += size;
    }

    return atoms;
  }

  /**
   * Read bytes from buffer into a Uint8Array slice.
   */
  function sliceBuffer(buffer, offset, size) {
    return new Uint8Array(buffer, offset, size);
  }

  /**
   * Concatenate multiple Uint8Arrays into one.
   */
  function concatBytes(...arrays) {
    let totalLength = 0;
    for (const arr of arrays) totalLength += arr.byteLength;
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const arr of arrays) {
      result.set(arr, pos);
      pos += arr.byteLength;
    }
    return result;
  }

  /**
   * Fix STCO (chunk offset) atoms inside the moov data.
   * Offsets must be adjusted because moov moves before mdat.
   */
  function fixChunkOffsets(moovBytes, moovSize) {
    const view = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const result = new Uint8Array(moovBytes); // mutable copy
    const resultView = new DataView(result.buffer, result.byteOffset, result.byteLength);

    // Check for compressed moov
    if (moovBytes.length >= 16) {
      const compressionCheck = String.fromCharCode(
        view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15)
      );
      if (compressionCheck === ATOM_TYPES.CMOV) {
        throw new Error('Compressed MP4/QT files are not supported');
      }
    }

    const moovStartOffset = 12; // skip size+type header

    for (let i = moovStartOffset; i < moovBytes.length - 8; i++) {
      const atomType = String.fromCharCode(
        view.getUint8(i), view.getUint8(i + 1),
        view.getUint8(i + 2), view.getUint8(i + 3)
      );

      if (!isValidAtom(atomType)) continue;

      const atomSize = view.getUint32(i - 4);

      if (atomType === ATOM_TYPES.STCO) {
        // stco: 32-bit chunk offsets
        if (i + 12 > moovBytes.length) break;
        const entryCount = view.getUint32(i + 8);
        for (let j = 0; j < entryCount; j++) {
          const pos = i + 12 + j * 4;
          if (pos + 4 > moovBytes.length) break;
          const currentOffset = view.getUint32(pos);
          resultView.setUint32(pos, currentOffset + moovSize);
        }
        i += atomSize - 4;
      } else if (atomType === ATOM_TYPES.CO64) {
        // co64: 64-bit chunk offsets
        if (i + 12 > moovBytes.length) break;
        const entryCount = view.getUint32(i + 8);
        for (let j = 0; j < entryCount; j++) {
          const pos = i + 12 + j * 8;
          if (pos + 8 > moovBytes.length) break;
          const high = view.getUint32(pos);
          const low  = view.getUint32(pos + 4);
          const currentOffset = high * 0x100000000 + low;
          const newOffset = currentOffset + moovSize;
          resultView.setUint32(pos, Math.floor(newOffset / 0x100000000));
          resultView.setUint32(pos + 4, newOffset & 0xFFFFFFFF);
        }
        i += atomSize - 4;
      } else if (atomType === ATOM_TYPES.URL || atomType === ATOM_TYPES.XML) {
        i += atomSize - 4;
      } else if (atomSize > 8) {
        i += 4; // skip version/flags
      }
    }

    return result;
  }

  /**
   * Relocate the MOOV atom from end to beginning of an MP4 file.
   *
   * @param {ArrayBuffer|File|Blob} input - The input MP4 file
   * @returns {Promise<{blob: Blob, wasRelocated: boolean}>}
   */
  async function relocate(input) {
    // Convert to ArrayBuffer
    let buffer;
    if (input instanceof ArrayBuffer) {
      buffer = input;
    } else if (input instanceof Blob) {
      buffer = await input.arrayBuffer();
    } else {
      throw new Error('Input must be ArrayBuffer, Blob, or File');
    }

    const atoms = parseAtoms(buffer);

    if (atoms.length === 0) {
      throw new Error('No atoms found in file');
    }

    // Validate: first atom must be ftyp
    if (atoms[0].type !== ATOM_TYPES.FTYP) {
      throw new Error('Not a valid MP4/QT file (missing ftyp atom)');
    }

    // Check if moov is already at position 1 (after ftyp)
    if (atoms.length >= 2 && atoms[1].type === ATOM_TYPES.MOOV) {
      return {
        blob: new Blob([buffer], { type: 'video/mp4' }),
        wasRelocated: false,
      };
    }

    // Check if moov is at the end
    const lastAtom = atoms[atoms.length - 1];
    if (lastAtom.type !== ATOM_TYPES.MOOV) {
      // moov not at end — file may already be optimized or invalid
      return {
        blob: new Blob([buffer], { type: 'video/mp4' }),
        wasRelocated: false,
      };
    }

    // Extract the three sections: ftyp, middle (mdat etc), moov
    const ftypAtom = atoms[0];
    const moovAtom = lastAtom;

    const ftypBytes = sliceBuffer(buffer, ftypAtom.offset, ftypAtom.size);
    const moovBytesRaw = sliceBuffer(buffer, moovAtom.offset, moovAtom.size);

    // Middle: everything between ftyp and moov
    const middleStart = ftypAtom.offset + ftypAtom.size;
    const middleEnd = moovAtom.offset;
    const middleBytes = sliceBuffer(buffer, middleStart, middleEnd - middleStart);

    // Fix chunk offsets in moov
    const fixedMoovBytes = fixChunkOffsets(moovBytesRaw, moovAtom.size);

    // Reorder: ftyp + moov + middle
    const output = concatBytes(ftypBytes, fixedMoovBytes, middleBytes);

    return {
      blob: new Blob([output], { type: 'video/mp4' }),
      wasRelocated: true,
    };
  }

  /**
   * Check if an MP4 file needs MOOV relocation.
   * @param {ArrayBuffer|File|Blob} input
   * @returns {Promise<{needsRelocation: boolean, reason: string}>}
   */
  async function check(input) {
    let buffer;
    if (input instanceof ArrayBuffer) {
      buffer = input;
    } else if (input instanceof Blob) {
      buffer = await input.arrayBuffer();
    } else {
      throw new Error('Input must be ArrayBuffer, Blob, or File');
    }

    const atoms = parseAtoms(buffer);

    if (atoms.length === 0) {
      return { needsRelocation: false, reason: 'No atoms found' };
    }

    if (atoms[0].type !== ATOM_TYPES.FTYP) {
      return { needsRelocation: false, reason: 'Not a valid MP4 file' };
    }

    if (atoms.length >= 2 && atoms[1].type === ATOM_TYPES.MOOV) {
      return { needsRelocation: false, reason: 'MOOV already at beginning' };
    }

    const lastAtom = atoms[atoms.length - 1];
    if (lastAtom.type === ATOM_TYPES.MOOV) {
      return { needsRelocation: true, reason: 'MOOV at end of file — relocation recommended' };
    }

    return { needsRelocation: false, reason: 'MOOV position unknown' };
  }

  return { relocate, check, parseAtoms, ATOM_TYPES };
})();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MoovRelocator;
}