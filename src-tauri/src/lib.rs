use nostr_sdk::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
struct KeyResult {
    pubkey: String,
    npub: String,
}

#[derive(Serialize, Deserialize)]
struct KeyStore {
    nsec_bech32: String,
    pubkey_hex: String,
}

fn key_store_path(app: &tauri::AppHandle) -> PathBuf {
    let mut path = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&path).ok();
    path.push("nostr_key.json");
    path
}

fn read_store(app: &tauri::AppHandle) -> Result<Option<KeyStore>, String> {
    let path = key_store_path(app);
    if !path.exists() {
        return Ok(None);
    }
    let data =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read key store: {}", e))?;
    let store: KeyStore =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse key store: {}", e))?;
    Ok(Some(store))
}

fn write_store(app: &tauri::AppHandle, store: &KeyStore) -> Result<(), String> {
    let path = key_store_path(app);
    let data =
        serde_json::to_string(store).map_err(|e| format!("Failed to serialize key store: {}", e))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write key store: {}", e))?;
    Ok(())
}

fn remove_store(app: &tauri::AppHandle) -> Result<(), String> {
    let path = key_store_path(app);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to remove key store: {}", e))?;
    }
    Ok(())
}

fn get_keys(app: &tauri::AppHandle) -> Result<Keys, String> {
    let store = read_store(app)?.ok_or("No key stored")?;
    let secret_key = SecretKey::from_bech32(&store.nsec_bech32)
        .map_err(|e| format!("Invalid stored key: {}", e))?;
    Ok(Keys::new(secret_key))
}

fn keys_to_result(keys: &Keys) -> Result<KeyResult, String> {
    Ok(KeyResult {
        pubkey: hex::encode(keys.public_key().to_bytes()),
        npub: keys.public_key().to_bech32().map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
fn nostr_generate_key(app: tauri::AppHandle) -> Result<KeyResult, String> {
    let keys = Keys::generate();
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let result = keys_to_result(&keys)?;
    write_store(
        &app,
        &KeyStore {
            nsec_bech32: nsec,
            pubkey_hex: result.pubkey.clone(),
        },
    )?;
    Ok(result)
}

#[tauri::command]
fn nostr_import_key(app: tauri::AppHandle, nsec_or_hex: String) -> Result<KeyResult, String> {
    let secret_key = if nsec_or_hex.starts_with("nsec1") {
        SecretKey::from_bech32(&nsec_or_hex).map_err(|e| e.to_string())?
    } else {
        SecretKey::from_hex(&nsec_or_hex).map_err(|e| e.to_string())?
    };
    let keys = Keys::new(secret_key);
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| e.to_string())?;
    let result = keys_to_result(&keys)?;
    write_store(
        &app,
        &KeyStore {
            nsec_bech32: nsec,
            pubkey_hex: result.pubkey.clone(),
        },
    )?;
    Ok(result)
}

#[tauri::command]
fn nostr_sign_event(app: tauri::AppHandle, template: String) -> Result<String, String> {
    let keys = get_keys(&app)?;
    let raw: serde_json::Value =
        serde_json::from_str(&template).map_err(|e| format!("Invalid JSON: {}", e))?;

    let kind_val = raw["kind"].as_u64().ok_or("Missing kind")?;
    let kind: u16 = kind_val
        .try_into()
        .map_err(|_| format!("Kind value too large: {}", kind_val))?;
    let content = raw["content"].as_str().unwrap_or("");
    let created_at = raw["created_at"].as_u64().ok_or("Missing created_at")?;
    let pubkey_str = raw["pubkey"].as_str().unwrap_or("");

    let tags: Vec<Tag> = raw["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let parts: Vec<String> = v
                        .as_array()
                        .map(|inner| {
                            inner
                                .iter()
                                .map(|sv| sv.as_str().unwrap_or("").to_string())
                                .collect()
                        })
                        .unwrap_or_default();
                    if parts.is_empty() {
                        None
                    } else {
                        Tag::parse(parts).ok()
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let pubkey = PublicKey::from_hex(pubkey_str).map_err(|e| format!("Invalid pubkey: {}", e))?;
    let unsigned = UnsignedEvent::new(
        pubkey,
        Timestamp::from(created_at),
        Kind::from(kind),
        tags,
        content,
    );

    let signed = unsigned
        .sign_with_keys(&keys)
        .map_err(|e| format!("Signing failed: {}", e))?;

    serde_json::to_string(&signed).map_err(|e| format!("Serialization failed: {}", e))
}

#[tauri::command]
fn nostr_get_pubkey(app: tauri::AppHandle) -> Result<KeyResult, String> {
    let keys = get_keys(&app)?;
    keys_to_result(&keys)
}

#[tauri::command]
fn nostr_has_key(app: tauri::AppHandle) -> bool {
    read_store(&app).ok().flatten().is_some()
}

#[tauri::command]
fn nostr_remove_key(app: tauri::AppHandle) -> Result<(), String> {
    remove_store(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            nostr_generate_key,
            nostr_import_key,
            nostr_sign_event,
            nostr_get_pubkey,
            nostr_has_key,
            nostr_remove_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
