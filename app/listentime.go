package app

// ============ 听歌时长统计：MusicService 门面（委托 app/stats.Tracker） ============
//
// 实际跟踪与持久化逻辑已拆分到 app/stats 包（Tracker），
// 本文件仅保留 Wails 绑定的 MusicService 方法作为门面。

// RecordPlayStart 记录某首歌开始播放的时间
func (a *MusicService) RecordPlayStart(trackId int64) {
	if a.listenStats == nil {
		return
	}
	a.listenStats.RecordStart(trackId)
}

// RecordPlayPause 计算本次播放时长并累积
func (a *MusicService) RecordPlayPause(trackId int64) {
	if a.listenStats == nil {
		return
	}
	a.listenStats.RecordPause(trackId)
}

// GetListenTime 获取某首歌的累计听歌时长（秒）
func (a *MusicService) GetListenTime(trackId int64) int64 {
	if a.listenStats == nil {
		return 0
	}
	return a.listenStats.Get(trackId)
}

// GetTotalListenTime 获取所有歌曲的总听歌时长（秒）
func (a *MusicService) GetTotalListenTime() int64 {
	if a.listenStats == nil {
		return 0
	}
	return a.listenStats.Total()
}

// startListenTimeHeartbeat 启动听歌时长 heartbeat（供 ServiceStartup 调用）
func (a *MusicService) startListenTimeHeartbeat() {
	if a.listenStats != nil {
		a.listenStats.StartHeartbeat()
	}
}

// stopListenTimeHeartbeat 停止 heartbeat 并 flush 未写入时长（供 ServiceShutdown 调用）
func (a *MusicService) stopListenTimeHeartbeat() {
	if a.listenStats != nil {
		a.listenStats.StopHeartbeat()
		a.listenStats.Flush()
	}
}
