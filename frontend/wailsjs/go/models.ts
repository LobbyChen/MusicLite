export namespace format {
	
	export class MscData {
	    id: number;
	    name: string;
	    artist: string;
	    format: string;
	    src: string;
	    cover: string;
	    lyrics: string;
	
	    static createFrom(source: any = {}) {
	        return new MscData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.artist = source["artist"];
	        this.format = source["format"];
	        this.src = source["src"];
	        this.cover = source["cover"];
	        this.lyrics = source["lyrics"];
	    }
	}

}

export namespace main {
	
	export class I18nData {
	    version: number;
	    languages: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new I18nData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.languages = source["languages"];
	    }
	}
	export class PickedFile {
	    data: string;
	    mime: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new PickedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.mime = source["mime"];
	        this.text = source["text"];
	    }
	}
	export class Settings {
	    theme: string;
	    player_font: string;
	    lyrics_font: string;
	    ui_scale: number;
	    lyrics_scale: number;
	    last_track_id: number;
	    last_position: number;
	    volume: number;
	    accent_color: string;
	    language: string;
	    lyric_animation: string;
	    list_mode: string;
	    animation_level: number;
	    volume_mode: string;
	    max_lyric_lines: number;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.player_font = source["player_font"];
	        this.lyrics_font = source["lyrics_font"];
	        this.ui_scale = source["ui_scale"];
	        this.lyrics_scale = source["lyrics_scale"];
	        this.last_track_id = source["last_track_id"];
	        this.last_position = source["last_position"];
	        this.volume = source["volume"];
	        this.accent_color = source["accent_color"];
	        this.language = source["language"];
	        this.lyric_animation = source["lyric_animation"];
	        this.list_mode = source["list_mode"];
	        this.animation_level = source["animation_level"];
	        this.volume_mode = source["volume_mode"];
	        this.max_lyric_lines = source["max_lyric_lines"];
	    }
	}

}

export namespace storage {
	
	export class Database {
	
	
	    static createFrom(source: any = {}) {
	        return new Database(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

