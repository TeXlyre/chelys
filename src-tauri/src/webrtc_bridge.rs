use std::sync::Arc;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

#[derive(Default)]
struct RegistryInner {
    peers: DashMap<String, Arc<RTCPeerConnection>>,
    channels: DashMap<String, Arc<RTCDataChannel>>,
    peer_channels: DashMap<String, Vec<String>>,
}

#[derive(Clone, Default)]
pub struct WebRtcRegistry {
    inner: Arc<RegistryInner>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IceServerCfg {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PeerConfigCfg {
    pub ice_servers: Vec<IceServerCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataChannelInitCfg {
    pub ordered: Option<bool>,
    pub max_packet_life_time: Option<u16>,
    pub max_retransmits: Option<u16>,
    pub protocol: Option<String>,
    pub negotiated: Option<bool>,
    pub id: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SdpDto {
    #[serde(rename = "type")]
    pub sdp_type: String,
    pub sdp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IceCandidateDto {
    pub candidate: String,
    pub sdp_mid: Option<String>,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_mline_index: Option<u16>,
    pub username_fragment: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct PeerEvent {
    peer_id: String,
    #[serde(rename = "type")]
    event_type: String,
    payload: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
struct ChannelEvent {
    channel_id: String,
    #[serde(rename = "type")]
    event_type: String,
    payload: serde_json::Value,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn rtc_create_peer(
    app: AppHandle,
    registry: State<'_, WebRtcRegistry>,
    config: PeerConfigCfg,
) -> Result<String, String> {
    // let ice_servers: Vec<RTCIceServer> = config
    //     .ice_servers
    //     .into_iter()
    //     .map(|s| RTCIceServer {
    //         urls: s.urls,
    //         username: s.username.unwrap_or_default(),
    //         credential: s.credential.unwrap_or_default(),
    //         ..Default::default()
    //     })
    //     .collect();
    let ice_servers: Vec<RTCIceServer> = config
        .ice_servers
        .into_iter()
        .filter(|s| {
            !s.urls
                .iter()
                .any(|u| u.starts_with("turn:") || u.starts_with("turns:"))
        })
        .map(|s| RTCIceServer {
            urls: s.urls,
            username: s.username.unwrap_or_default(),
            credential: s.credential.unwrap_or_default(),
            ..Default::default()
        })
        .collect();

    let api = APIBuilder::new().build();
    let pc = api
        .new_peer_connection(RTCConfiguration {
            ice_servers,
            ..Default::default()
        })
        .await
        .map_err(err)?;

    let peer_id = Uuid::new_v4().to_string();
    let pc = Arc::new(pc);

    let app1 = app.clone();
    let pid1 = peer_id.clone();
    pc.on_ice_candidate(Box::new(move |c| {
        let app = app1.clone();
        let pid = pid1.clone();
        Box::pin(async move {
            let payload = match c {
                Some(cand) => match cand.to_json() {
                    Ok(j) => {
                        let sdp_mid = match j.sdp_mid {
                            Some(s) if !s.is_empty() => s,
                            _ => "0".to_string(),
                        };
                        serde_json::to_value(&IceCandidateDto {
                            candidate: j.candidate,
                            sdp_mid: Some(sdp_mid),
                            sdp_mline_index: Some(j.sdp_mline_index.unwrap_or(0)),
                            username_fragment: j.username_fragment,
                        })
                        .unwrap_or(serde_json::Value::Null)
                    }
                    Err(_) => serde_json::Value::Null,
                },
                None => serde_json::Value::Null,
            };
            let _ = app.emit(
                "rtc-peer",
                PeerEvent {
                    peer_id: pid,
                    event_type: "icecandidate".into(),
                    payload,
                },
            );
        })
    }));

    let app2 = app.clone();
    let pid2 = peer_id.clone();
    pc.on_ice_connection_state_change(Box::new(move |s| {
        let app = app2.clone();
        let pid = pid2.clone();
        Box::pin(async move {
            let _ = app.emit(
                "rtc-peer",
                PeerEvent {
                    peer_id: pid,
                    event_type: "iceconnectionstatechange".into(),
                    payload: serde_json::Value::String(s.to_string()),
                },
            );
        })
    }));

    let app3 = app.clone();
    let pid3 = peer_id.clone();
    pc.on_peer_connection_state_change(Box::new(move |s| {
        let app = app3.clone();
        let pid = pid3.clone();
        Box::pin(async move {
            let _ = app.emit(
                "rtc-peer",
                PeerEvent {
                    peer_id: pid,
                    event_type: "connectionstatechange".into(),
                    payload: serde_json::Value::String(s.to_string()),
                },
            );
        })
    }));

    let app4 = app.clone();
    let pid4 = peer_id.clone();
    pc.on_signaling_state_change(Box::new(move |s| {
        let app = app4.clone();
        let pid = pid4.clone();
        Box::pin(async move {
            let _ = app.emit(
                "rtc-peer",
                PeerEvent {
                    peer_id: pid,
                    event_type: "signalingstatechange".into(),
                    payload: serde_json::Value::String(s.to_string()),
                },
            );
        })
    }));

    let app5 = app.clone();
    let pid5 = peer_id.clone();
    let registry_arc = registry.inner.clone();
    pc.on_data_channel(Box::new(move |dc| {
        let app = app5.clone();
        let pid = pid5.clone();
        let registry = registry_arc.clone();
        let channel_id = Uuid::new_v4().to_string();
        registry.channels.insert(channel_id.clone(), dc.clone());
        registry
            .peer_channels
            .entry(pid.clone())
            .or_default()
            .push(channel_id.clone());
        attach_channel_handlers(app.clone(), channel_id.clone(), dc.clone());
        Box::pin(async move {
            let _ = app.emit(
                "rtc-peer",
                PeerEvent {
                    peer_id: pid,
                    event_type: "datachannel".into(),
                    payload: serde_json::json!({
                        "channelId": channel_id,
                        "label": dc.label(),
                        "ordered": dc.ordered(),
                        "protocol": dc.protocol(),
                    }),
                },
            );
        })
    }));

    registry.inner.peers.insert(peer_id.clone(), pc);
    Ok(peer_id)
}

fn attach_channel_handlers(app: AppHandle, channel_id: String, dc: Arc<RTCDataChannel>) {
    let app1 = app.clone();
    let cid1 = channel_id.clone();
    dc.on_open(Box::new(move || {
        let app = app1.clone();
        let cid = cid1.clone();
        Box::pin(async move {
            let _ = app.emit(
                "rtc-channel",
                ChannelEvent {
                    channel_id: cid,
                    event_type: "open".into(),
                    payload: serde_json::Value::Null,
                },
            );
        })
    }));

    let app2 = app.clone();
    let cid2 = channel_id.clone();
    dc.on_close(Box::new(move || {
        let app = app2.clone();
        let cid = cid2.clone();
        Box::pin(async move {
            let _ = app.emit(
                "rtc-channel",
                ChannelEvent {
                    channel_id: cid,
                    event_type: "close".into(),
                    payload: serde_json::Value::Null,
                },
            );
        })
    }));

    let app3 = app.clone();
    let cid3 = channel_id.clone();
    dc.on_error(Box::new(move |e| {
        let app = app3.clone();
        let cid = cid3.clone();
        Box::pin(async move {
            let _ = app.emit(
                "rtc-channel",
                ChannelEvent {
                    channel_id: cid,
                    event_type: "error".into(),
                    payload: serde_json::Value::String(e.to_string()),
                },
            );
        })
    }));

    let app4 = app.clone();
    let cid4 = channel_id.clone();
    dc.on_message(Box::new(move |msg: DataChannelMessage| {
        let app = app4.clone();
        let cid = cid4.clone();
        Box::pin(async move {
            let payload = serde_json::json!({
                "kind": if msg.is_string { "string" } else { "binary" },
                "data": msg.data.to_vec(),
            });
            let _ = app.emit(
                "rtc-channel",
                ChannelEvent {
                    channel_id: cid,
                    event_type: "message".into(),
                    payload,
                },
            );
        })
    }));

    use webrtc::data_channel::data_channel_state::RTCDataChannelState;
    if dc.ready_state() == RTCDataChannelState::Open {
        let app_emit = app.clone();
        let cid_emit = channel_id.clone();
        tokio::spawn(async move {
            let _ = app_emit.emit(
                "rtc-channel",
                ChannelEvent {
                    channel_id: cid_emit,
                    event_type: "open".into(),
                    payload: serde_json::Value::Null,
                },
            );
        });
    }
}

#[tauri::command]
pub async fn rtc_create_data_channel(
    app: AppHandle,
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
    channel_id: String,
    label: String,
    init: Option<DataChannelInitCfg>,
) -> Result<(), String> {
    let pc = registry
        .inner
        .peers
        .get(&peer_id)
        .ok_or_else(|| "peer not found".to_string())?
        .clone();

    let dc_init = init.map(|i| RTCDataChannelInit {
        ordered: i.ordered,
        max_packet_life_time: i.max_packet_life_time,
        max_retransmits: i.max_retransmits,
        protocol: i.protocol,
        negotiated: i.negotiated.and_then(|n| if n { i.id } else { None }),
        ..Default::default()
    });

    let dc = pc.create_data_channel(&label, dc_init).await.map_err(err)?;
    registry
        .inner
        .channels
        .insert(channel_id.clone(), dc.clone());
    registry
        .inner
        .peer_channels
        .entry(peer_id)
        .or_default()
        .push(channel_id.clone());
    attach_channel_handlers(app, channel_id, dc);
    Ok(())
}

#[tauri::command]
pub async fn rtc_create_offer(
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
) -> Result<SdpDto, String> {
    let pc = registry
        .inner
        .peers
        .get(&peer_id)
        .ok_or_else(|| "peer not found".to_string())?
        .clone();
    let offer = pc.create_offer(None).await.map_err(err)?;
    Ok(SdpDto {
        sdp_type: offer.sdp_type.to_string(),
        sdp: offer.sdp.clone(),
    })
}

#[tauri::command]
pub async fn rtc_create_answer(
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
) -> Result<SdpDto, String> {
    let pc = registry
        .inner
        .peers
        .get(&peer_id)
        .ok_or_else(|| "peer not found".to_string())?
        .clone();
    let answer = pc.create_answer(None).await.map_err(err)?;
    Ok(SdpDto {
        sdp_type: answer.sdp_type.to_string(),
        sdp: answer.sdp.clone(),
    })
}

#[tauri::command]
pub async fn rtc_set_local_description(
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
    sdp: SdpDto,
) -> Result<(), String> {
    let pc = registry
        .inner
        .peers
        .get(&peer_id)
        .ok_or_else(|| "peer not found".to_string())?
        .clone();
    let desc = match sdp.sdp_type.as_str() {
        "offer" => RTCSessionDescription::offer(sdp.sdp).map_err(err)?,
        "answer" => RTCSessionDescription::answer(sdp.sdp).map_err(err)?,
        "pranswer" => RTCSessionDescription::pranswer(sdp.sdp).map_err(err)?,
        _ => return Err(format!("unsupported sdp type: {}", sdp.sdp_type)),
    };
    pc.set_local_description(desc).await.map_err(err)
}

#[tauri::command]
pub async fn rtc_set_remote_description(
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
    sdp: SdpDto,
) -> Result<(), String> {
    let pc = registry
        .inner
        .peers
        .get(&peer_id)
        .ok_or_else(|| "peer not found".to_string())?
        .clone();
    let desc = match sdp.sdp_type.as_str() {
        "offer" => RTCSessionDescription::offer(sdp.sdp).map_err(err)?,
        "answer" => RTCSessionDescription::answer(sdp.sdp).map_err(err)?,
        "pranswer" => RTCSessionDescription::pranswer(sdp.sdp).map_err(err)?,
        _ => return Err(format!("unsupported sdp type: {}", sdp.sdp_type)),
    };
    pc.set_remote_description(desc).await.map_err(err)
}

#[tauri::command]
pub async fn rtc_add_ice_candidate(
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
    candidate: IceCandidateDto,
) -> Result<(), String> {
    let pc = registry
        .inner
        .peers
        .get(&peer_id)
        .ok_or_else(|| "peer not found".to_string())?
        .clone();
    pc.add_ice_candidate(RTCIceCandidateInit {
        candidate: candidate.candidate,
        sdp_mid: candidate.sdp_mid,
        sdp_mline_index: candidate.sdp_mline_index,
        username_fragment: candidate.username_fragment,
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub async fn rtc_close_peer(
    registry: State<'_, WebRtcRegistry>,
    peer_id: String,
) -> Result<(), String> {
    if let Some((_, channel_ids)) = registry.inner.peer_channels.remove(&peer_id) {
        for cid in channel_ids {
            if let Some((_, dc)) = registry.inner.channels.remove(&cid) {
                let _ = dc.close().await;
            }
        }
    }
    if let Some((_, pc)) = registry.inner.peers.remove(&peer_id) {
        pc.close().await.map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn rtc_channel_send_string(
    registry: State<'_, WebRtcRegistry>,
    channel_id: String,
    data: String,
) -> Result<(), String> {
    let dc = registry
        .inner
        .channels
        .get(&channel_id)
        .ok_or_else(|| "channel not found".to_string())?
        .clone();
    dc.send_text(data).await.map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn rtc_channel_send_binary(
    registry: State<'_, WebRtcRegistry>,
    channel_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let dc = registry
        .inner
        .channels
        .get(&channel_id)
        .ok_or_else(|| "channel not found".to_string())?
        .clone();
    dc.send(&bytes::Bytes::from(data)).await.map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn rtc_channel_close(
    registry: State<'_, WebRtcRegistry>,
    channel_id: String,
) -> Result<(), String> {
    if let Some((_, dc)) = registry.inner.channels.remove(&channel_id) {
        dc.close().await.map_err(err)?;
    }
    Ok(())
}
