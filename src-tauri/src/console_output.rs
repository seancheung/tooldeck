//! A stream-local line renderer: CR moves the cursor, LF commits the line.
//! This deliberately does not implement cursor movement across completed lines.
use crate::runner::EventSink;
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Default)]
struct Lines {
    text: Vec<char>,
    cursor: usize,
    utf8: Vec<u8>,
    line: u64,
    dirty: bool,
}

impl Lines {
    fn character(&mut self, c: char) {
        if self.cursor < self.text.len() { self.text[self.cursor] = c; }
        else { self.text.push(c); }
        self.cursor += 1;
        self.dirty = true;
    }

    fn snapshot(&self, closed: bool, emit: &mut impl FnMut(u64, String, bool)) {
        emit(self.line, self.text.iter().collect(), closed);
    }

    fn feed(&mut self, bytes: &[u8], emit: &mut impl FnMut(u64, String, bool)) {
        self.utf8.extend_from_slice(bytes);
        let (text, consumed) = match std::str::from_utf8(&self.utf8) {
            Ok(s) => (s.to_owned(), self.utf8.len()),
            Err(e) if e.error_len().is_none() =>
                (String::from_utf8_lossy(&self.utf8[..e.valid_up_to()]).into_owned(), e.valid_up_to()),
            Err(_) => (String::from_utf8_lossy(&self.utf8).into_owned(), self.utf8.len()),
        };
        self.utf8.drain(..consumed);
        for c in text.chars() {
            match c {
                '\r' => self.cursor = 0,
                '\n' => {
                    self.snapshot(true, emit);
                    self.text.clear();
                    self.cursor = 0;
                    self.line += 1;
                    self.dirty = false;
                }
                _ => self.character(c),
            }
        }
        if self.dirty { self.snapshot(false, emit); self.dirty = false; }
    }

    fn finish(&mut self, emit: &mut impl FnMut(u64, String, bool)) {
        for c in String::from_utf8_lossy(&std::mem::take(&mut self.utf8)).chars() {
            self.character(c);
        }
        if !self.text.is_empty() { self.snapshot(true, emit); }
    }
}

pub async fn read(mut reader: impl AsyncRead + Unpin, sink: EventSink, run: String, level: &'static str) {
    let stream = uuid::Uuid::new_v4();
    let mut emit = |line, message, closed| sink(&run, "log", json!({
        "message": message, "level": level,
        "outputLineId": format!("{stream}:{line}"), "closed": closed,
    }));
    let mut lines = Lines::default();
    let mut buffer = [0; 8192];
    while let Ok(size) = reader.read(&mut buffer).await {
        if size == 0 { break; }
        lines.feed(&buffer[..size], &mut emit);
    }
    lines.finish(&mut emit);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pipe_updates_before_newline_and_flushes_at_eof() {
        use tokio::io::AsyncWriteExt;
        let (mut writer, reader) = tokio::io::duplex(128);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let sink: EventSink = std::sync::Arc::new(move |_, _, event| { tx.send(event).unwrap(); });
        let task = tokio::spawn(read(reader, sink, "run".into(), "warning"));
        writer.write_all(b"\r10%").await.unwrap();
        let first = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await.unwrap().unwrap();
        assert_eq!(first["message"], "10%");
        assert_eq!(first["closed"], false);
        writer.write_all(b"\r20%").await.unwrap();
        drop(writer);
        task.await.unwrap();
        let update = rx.recv().await.unwrap();
        let final_line = rx.recv().await.unwrap();
        assert_eq!(update["outputLineId"], first["outputLineId"]);
        assert_eq!(final_line["message"], "20%");
        assert_eq!(final_line["closed"], true);
    }

    #[test]
    fn carriage_returns_and_split_crlf_preserve_completed_lines() {
        let mut lines = Lines::default();
        let mut events = Vec::new();
        let mut emit = |id, text, closed| events.push((id, text, closed));
        for chunk in ["normal\r", "\nabcdef", "\rXY", "\r", "\nnext\n", "tail\r"] {
            lines.feed(chunk.as_bytes(), &mut emit);
        }
        lines.finish(&mut emit);
        let committed: Vec<_> = events.iter().filter(|e| e.2).map(|e| (e.0, e.1.as_str())).collect();
        assert_eq!(committed, [(0, "normal"), (1, "XYcdef"), (2, "next"), (3, "tail")]);
        assert!(events.iter().any(|e| e.0 == 1 && e.1 == "XYcdef" && !e.2));
    }

    #[test]
    fn unicode_split_at_every_byte_and_empty_lines() {
        let mut lines = Lines::default();
        let mut events = Vec::new();
        let mut emit = |id, text, closed| events.push((id, text, closed));
        for byte in "\r中文\r完成\r\n\n末尾".as_bytes() { lines.feed(&[*byte], &mut emit); }
        lines.finish(&mut emit);
        let committed: Vec<_> = events.iter().filter(|e| e.2).map(|e| e.1.as_str()).collect();
        assert_eq!(committed, ["完成", "", "末尾"]);
    }
}
