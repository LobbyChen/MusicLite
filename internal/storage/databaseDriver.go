package storage

import (
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	sqliteURL string
	database  *sql.DB
}

type Sqlite3Type string

const (
	INTEGER Sqlite3Type = "INTEGER"
	TEXT    Sqlite3Type = "TEXT"
	REAL    Sqlite3Type = "REAL"
	BLOB    Sqlite3Type = "BLOB"
	NULL    Sqlite3Type = "NULL"
)

// FieldDef 定义单个字段的详细属性
type FieldDef struct {
	Name         string      // 字段名
	Type         Sqlite3Type // 字段类型 (INTEGER, TEXT, etc.)
	IsPrimaryKey bool        // 是否为主键 (自动添加 AUTOINCREMENT)
	NotNull      bool        // 是否非空 (NOT NULL)
	Unique       bool        // 是否唯一 (UNIQUE)
	DefaultVal   *string     // 默认值 (如果为 nil 则不设置)
}

func CreateDataBaseObj() *Database {
	returnObj := &Database{}
	return returnObj
}

func (self *Database) OpenConnect(sqliteURL string) (bool, error) {
	self.sqliteURL = sqliteURL
	var err error
	self.database, err = sql.Open("sqlite3", self.sqliteURL)
	if err != nil {
		return false, fmt.Errorf("Wrong Sqlconnect : %s", err)
	}

	// 测试连接
	err = self.database.Ping()
	if err != nil {
		return false, fmt.Errorf("Failed to ping database : %s", err)
	}

	return true, nil
}

// 查询数据，返回包含该数据的全行的键值对map
// 如果有多个，则返回的Slice类型 length>1
func (self Database) FindData(TableName string, FindName string) ([]map[string]any, error) {
	basicSQL := "SELECT %s FROM %s;"
	sqlCommand := fmt.Sprintf(basicSQL, FindName, TableName)
	rows, err := self.database.Query(sqlCommand)
	if err != nil {
		return nil, fmt.Errorf("Wrong Table Or Name : \n %v", err)
	}
	defer rows.Close()

	// 获取列名
	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("Failed to get columns : %v", err)
	}

	var results []map[string]any
	for rows.Next() {
		// 创建一个切片来存储每一行的数据
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))

		for i := range values {
			valuePtrs[i] = &values[i]
		}

		// 扫描数据
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("Failed to scan row : %v", err)
		}

		// 创建映射
		rowMap := make(map[string]any)
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			rowMap[col] = val
		}

		results = append(results, rowMap)
	}

	return results, nil
}

// 根据条件查询数据
func (self Database) FindDataWithCondition(TableName string, FindName string, condition string, args ...interface{}) ([]map[any]any, error) {
	basicSQL := "SELECT %s FROM %s WHERE %s"
	sqlCommand := fmt.Sprintf(basicSQL, FindName, TableName, condition)
	rows, err := self.database.Query(sqlCommand, args...)
	if err != nil {
		return nil, fmt.Errorf("Wrong query : \n %v", err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("Failed to get columns : %v", err)
	}

	var results []map[any]any

	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))

		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("Failed to scan row : %v", err)
		}

		rowMap := make(map[any]any)
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			rowMap[col] = val
		}

		results = append(results, rowMap)
	}

	return results, nil
}

// 插入数据
func (self Database) InsertData(TableName string, data map[string]interface{}) (int64, error) {
	if len(data) == 0 {
		return 0, fmt.Errorf("No data provided for insertion")
	}

	// 构建列名和占位符
	var columns []string
	var placeholders []string
	var values []interface{}

	for col, val := range data {
		columns = append(columns, col)
		placeholders = append(placeholders, "?")
		values = append(values, val)
	}

	basicSQL := "INSERT INTO %s (%s) VALUES (%s)"
	sqlCommand := fmt.Sprintf(basicSQL, TableName,
		fmt.Sprintf("%s", joinStrings(columns, ",")),
		fmt.Sprintf("%s", joinStrings(placeholders, ",")))

	result, err := self.database.Exec(sqlCommand, values...)
	if err != nil {
		return 0, fmt.Errorf("Insert failed : %v", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("Failed to get last insert id : %v", err)
	}

	return id, nil
}

// 更新数据
func (self Database) UpdateData(TableName string, updateData map[string]interface{}, condition string, args ...interface{}) (int64, error) {
	if len(updateData) == 0 {
		return 0, fmt.Errorf("No data provided for update")
	}

	var setParts []string
	var values []interface{}

	for col, val := range updateData {
		setParts = append(setParts, col+" = ?")
		values = append(values, val)
	}

	// 添加条件参数
	values = append(values, args...)

	basicSQL := "UPDATE %s SET %s WHERE %s"
	sqlCommand := fmt.Sprintf(basicSQL, TableName,
		fmt.Sprintf("%s", joinStrings(setParts, ",")),
		condition)

	result, err := self.database.Exec(sqlCommand, values...)
	if err != nil {
		return 0, fmt.Errorf("Update failed : %v", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("Failed to get affected rows : %v", err)
	}

	return rowsAffected, nil
}

// 删除数据
func (self Database) DeleteData(TableName string, condition string, args ...interface{}) (int64, error) {
	basicSQL := "DELETE FROM %s WHERE %s"
	sqlCommand := fmt.Sprintf(basicSQL, TableName, condition)

	result, err := self.database.Exec(sqlCommand, args...)
	if err != nil {
		return 0, fmt.Errorf("Delete failed : %v", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("Failed to get affected rows : %v", err)
	}

	return rowsAffected, nil
}

// 获取表的所有数据
func (self Database) GetAllData(TableName string) ([]map[any]any, error) {
	sqlCommand := fmt.Sprintf("SELECT * FROM \"%s\";", TableName)
	rows, err := self.database.Query(sqlCommand)
	if err != nil {
		return nil, fmt.Errorf("Wrong query : \n %v", err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("Failed to get columns : %v", err)
	}

	var results []map[any]any

	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))

		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("Failed to scan row : %v", err)
		}

		rowMap := make(map[any]any)
		for i, col := range columns {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			rowMap[col] = val
		}

		results = append(results, rowMap)
	}

	return results, nil
}

// 检查表是否存在
func (self Database) TableExists(tableName string) (bool, error) {
	query := `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`
	rows, err := self.database.Query(query, tableName)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	return rows.Next(), nil
}

// CreateTableWithFields 创建带字段的表
func (self Database) CreateTableWithFields(tableName string, fields []FieldDef) error {
	if len(fields) == 0 {
		return fmt.Errorf("cannot create table: no fields provided")
	}

	var columnDefs []string
	primaryKeyCount := 0

	for _, f := range fields {
		colDef := fmt.Sprintf("\"%s\" %s", f.Name, f.Type)

		// 2. 主键处理
		if f.IsPrimaryKey {
			primaryKeyCount++
			if primaryKeyCount > 1 {
				return fmt.Errorf("multiple primary keys defined in table '%s'", tableName)
			}
			colDef += " PRIMARY KEY AUTOINCREMENT"
		}

		// 3. 非空约束
		if f.NotNull && !f.IsPrimaryKey {
			colDef += " NOT NULL"
		} else if f.NotNull && f.IsPrimaryKey {

		}

		// 4. 唯一约束
		if f.Unique && !f.IsPrimaryKey {
			colDef += " UNIQUE"
		}

		// 5. 默认值
		if f.DefaultVal != nil {
			valStr := *f.DefaultVal
			if f.Type == TEXT {
				// 确保字符串默认值有单引号
				if !strings.HasPrefix(valStr, "'") && !strings.HasSuffix(valStr, "'") {
					valStr = fmt.Sprintf("'%s'", valStr)
				}
			}
			colDef += fmt.Sprintf(" DEFAULT %s", valStr)
		}

		columnDefs = append(columnDefs, colDef)
	}

	columnsSQL := strings.Join(columnDefs, ",\n  ")

	sqlCommand := fmt.Sprintf("CREATE TABLE IF NOT EXISTS \"%s\" (\n  %s\n);", tableName, columnsSQL)

	_, err := self.database.Exec(sqlCommand)
	if err != nil {
		return fmt.Errorf("failed to create table '%s': %w", tableName, err)
	}

	return nil
}

// 创建表
func (self Database) CreateTable(tableName string) error {
	sqlCommand := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s", tableName)
	_, err := self.database.Exec(sqlCommand)
	if err != nil {
		return fmt.Errorf("Create table failed : %v", err)
	}
	return nil
}

func (self Database) IsEmpty() bool {
	if self.database != nil {
		return true
	}
	return false
}

// 辅助函数：连接字符串
func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for _, s := range strs[1:] {
		result += sep + s
	}
	return result
}

func (self *Database) Close() {
	if self.database != nil {
		self.database.Close()
	}
}

// ============ Tracks 表专用方法 ============

// TrackRecord 表示 tracks 表的一行记录
type TrackRecord struct {
	ID         int64
	Title      string
	Artist     string
	Album      string
	FilePath   string
	CoverData  []byte
	CoverMIME  string
	Lyrics     string
	Format     string
	ImportedAt int64
}

// EnsureTracksTable 创建 tracks 表（如果不存在）；对旧表自动补充 album 列
func (self Database) EnsureTracksTable() error {
	sqlCommand := `CREATE TABLE IF NOT EXISTS "tracks" (
		"id"         INTEGER PRIMARY KEY AUTOINCREMENT,
		"title"      TEXT NOT NULL,
		"artist"     TEXT,
		"album"      TEXT,
		"file_path"  TEXT NOT NULL,
		"cover_data" BLOB,
		"cover_mime" TEXT,
		"lyrics"     TEXT,
		"format"     TEXT,
		"imported_at" INTEGER
	);`
	if _, err := self.database.Exec(sqlCommand); err != nil {
		return err
	}
	// 迁移：旧版本库可能没有 album 列，用 ADD COLUMN 补上（SQLite 3.35.0+ 支持 IF NOT EXISTS，这里用探测式迁移更兼容）
	columns, err := self.database.Query(`PRAGMA table_info("tracks")`)
	if err != nil {
		return fmt.Errorf("pragma table_info failed: %w", err)
	}
	defer columns.Close()
	hasAlbum := false
	for columns.Next() {
		var (
			cid        int
			name       string
			colType    string
			notnull    int
			dfltValue  *string
			pk         int
		)
		if err := columns.Scan(&cid, &name, &colType, &notnull, &dfltValue, &pk); err != nil {
			continue
		}
		if name == "album" {
			hasAlbum = true
			break
		}
	}
	if !hasAlbum {
		if _, err := self.database.Exec(`ALTER TABLE "tracks" ADD COLUMN "album" TEXT`); err != nil {
			return fmt.Errorf("migrate add album column failed: %w", err)
		}
	}
	return nil
}

// InsertTrack 插入一条曲目记录，返回新记录 ID
func (self Database) InsertTrack(rec TrackRecord) (int64, error) {
	result, err := self.database.Exec(
		`INSERT INTO tracks (title, artist, album, file_path, cover_data, cover_mime, lyrics, format, imported_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.Title, rec.Artist, rec.Album, rec.FilePath, rec.CoverData, rec.CoverMIME,
		rec.Lyrics, rec.Format, rec.ImportedAt,
	)
	if err != nil {
		return 0, fmt.Errorf("insert track failed: %w", err)
	}
	return result.LastInsertId()
}

// GetAllTrackRecords 返回所有曲目（含 lyrics，列表展示和歌词编辑回显用）
func (self Database) GetAllTrackRecords() ([]TrackRecord, error) {
	rows, err := self.database.Query(
		`SELECT id, title, artist, album, file_path, cover_mime, lyrics, format, imported_at FROM tracks ORDER BY imported_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("query tracks failed: %w", err)
	}
	defer rows.Close()

	var results []TrackRecord
	for rows.Next() {
		var r TrackRecord
		var artist, album, coverMIME, lyrics, format sql.NullString
		if err := rows.Scan(&r.ID, &r.Title, &artist, &album, &r.FilePath, &coverMIME, &lyrics, &format, &r.ImportedAt); err != nil {
			return nil, fmt.Errorf("scan track failed: %w", err)
		}
		r.Artist = artist.String
		r.Album = album.String
		r.CoverMIME = coverMIME.String
		r.Lyrics = lyrics.String
		r.Format = format.String
		results = append(results, r)
	}
	return results, nil
}

// GetTrackByID 返回单首曲目的完整记录（含歌词，播放器页用）
func (self Database) GetTrackByID(id int64) (*TrackRecord, error) {
	var r TrackRecord
	var artist, album, coverMIME, lyrics, format sql.NullString
	err := self.database.QueryRow(
		`SELECT id, title, artist, album, file_path, cover_mime, lyrics, format, imported_at
		 FROM tracks WHERE id = ?`, id,
	).Scan(&r.ID, &r.Title, &artist, &album, &r.FilePath, &coverMIME, &lyrics, &format, &r.ImportedAt)
	if err != nil {
		return nil, fmt.Errorf("query track %d failed: %w", id, err)
	}
	r.Artist = artist.String
	r.Album = album.String
	r.CoverMIME = coverMIME.String
	r.Lyrics = lyrics.String
	r.Format = format.String
	return &r, nil
}

// GetTrackFilePath 仅返回曲目磁盘路径（音频流 Handler 用）
func (self Database) GetTrackFilePath(id string) (string, error) {
	var filePath string
	err := self.database.QueryRow(`SELECT file_path FROM tracks WHERE id = ?`, id).Scan(&filePath)
	if err != nil {
		return "", err
	}
	return filePath, nil
}

// GetTrackCover 返回封面二进制和 MIME 类型（封面流 Handler 用）
func (self Database) GetTrackCover(id string) ([]byte, string, error) {
	var data []byte
	var mime sql.NullString
	err := self.database.QueryRow(`SELECT cover_data, cover_mime FROM tracks WHERE id = ?`, id).Scan(&data, &mime)
	if err != nil {
		return nil, "", err
	}
	return data, mime.String, nil
}

// HasCover 返回该曲目是否有封面
func (self Database) HasCover(id int64) (bool, error) {
	var data []byte
	err := self.database.QueryRow(`SELECT cover_data FROM tracks WHERE id = ?`, id).Scan(&data)
	if err != nil {
		return false, err
	}
	return len(data) > 0, nil
}

// UpdateTrack 更新曲目基本信息（标题、艺术家、专辑、歌词）
func (self Database) UpdateTrack(id int64, title, artist, album, lyrics string) error {
	_, err := self.database.Exec(
		`UPDATE tracks SET title = ?, artist = ?, album = ?, lyrics = ? WHERE id = ?`,
		title, artist, album, lyrics, id,
	)
	if err != nil {
		return fmt.Errorf("update track %d failed: %w", id, err)
	}
	return nil
}

// UpdateTrackCover 更新曲目封面
func (self Database) UpdateTrackCover(id int64, coverData []byte, coverMIME string) error {
	_, err := self.database.Exec(
		`UPDATE tracks SET cover_data = ?, cover_mime = ? WHERE id = ?`,
		coverData, coverMIME, id,
	)
	if err != nil {
		return fmt.Errorf("update track cover %d failed: %w", id, err)
	}
	return nil
}

// DeleteTrack 删除一条曲目记录
func (self Database) DeleteTrack(id int64) error {
	_, err := self.database.Exec(`DELETE FROM tracks WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete track %d failed: %w", id, err)
	}
	return nil
}
