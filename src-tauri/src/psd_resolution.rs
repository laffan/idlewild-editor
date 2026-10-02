//! The resolution a PSD says it was made at.
//!
//! A PSD's pixels have no size until the file says how many go to the inch,
//! and the fork's writer leaves that section empty — which Photoshop reads as
//! 72. For a game that is the right answer. For a print project's file it is
//! the wrong one by a factor of four or eight: a letter page at 300 DPI opens
//! as a picture thirty-five inches wide. So a print project's files are
//! stamped with the `ResolutionInfo` resource (id 1005) on the way through the
//! pipeline, and Photoshop opens them at the size of the paper.
//!
//! Only a file whose image-resources section is empty is touched. That is
//! every file this editor writes, and no file Photoshop does: a file somebody
//! brought home already says what it is, and saying something else over it
//! is not this code's business.

/// The file with its resolution written in, or None when it already says
/// something or cannot be read as a PSD.
pub fn stamp(bytes: &[u8], dpi: u32) -> Option<Vec<u8>> {
    if bytes.len() < 30 || &bytes[..4] != b"8BPS" {
        return None;
    }
    let colour_len = u32::from_be_bytes(bytes[26..30].try_into().ok()?) as usize;
    let at = 30usize.checked_add(colour_len)?;
    if bytes.len() < at + 4 {
        return None;
    }
    let resources_len = u32::from_be_bytes(bytes[at..at + 4].try_into().ok()?);
    if resources_len != 0 {
        return None;
    }

    let fixed = (dpi as u32) << 16;
    let mut resource = Vec::with_capacity(28);
    resource.extend_from_slice(b"8BIM");
    resource.extend_from_slice(&1005u16.to_be_bytes());
    // An empty Pascal name, padded to an even length.
    resource.extend_from_slice(&[0, 0]);
    resource.extend_from_slice(&16u32.to_be_bytes());
    for _ in 0..2 {
        resource.extend_from_slice(&fixed.to_be_bytes());
        // Pixels per inch, and the size shown in inches.
        resource.extend_from_slice(&1u16.to_be_bytes());
        resource.extend_from_slice(&1u16.to_be_bytes());
    }

    let mut out = Vec::with_capacity(bytes.len() + resource.len());
    out.extend_from_slice(&bytes[..at]);
    out.extend_from_slice(&(resource.len() as u32).to_be_bytes());
    out.extend_from_slice(&resource);
    out.extend_from_slice(&bytes[at + 4..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use psd::{LayerBuilder, Psd, PsdBuilder};

    #[test]
    fn a_stamped_file_still_reads_and_is_not_stamped_twice() {
        let mut builder = PsdBuilder::new(4, 4);
        builder.add_layer(LayerBuilder::new("S | dot").rgba(4, 4, vec![255; 64]));
        let bytes = builder.to_bytes().unwrap();

        let stamped = stamp(&bytes, 300).expect("an empty section is stamped");
        let doc = Psd::from_bytes(&stamped).expect("still a PSD");
        assert_eq!((doc.width(), doc.height()), (4, 4));
        assert_eq!(doc.layers().len(), 1);
        assert!(stamp(&stamped, 600).is_none());
        let i = stamped.windows(4).position(|w| w == b"8BIM").unwrap();
        assert_eq!(&stamped[i + 4..i + 6], &1005u16.to_be_bytes());
        assert_eq!(&stamped[i + 12..i + 14], &300u16.to_be_bytes());
    }
}
