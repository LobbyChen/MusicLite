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
	
	export class Settings {
	    theme: string;
	    player_font: string;
	    lyrics_font: string;
	    last_track_id: number;
	    last_position: number;
	    volume: number;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.player_font = source["player_font"];
	        this.lyrics_font = source["lyrics_font"];
	        this.last_track_id = source["last_track_id"];
	        this.last_position = source["last_position"];
	        this.volume = source["volume"];
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

